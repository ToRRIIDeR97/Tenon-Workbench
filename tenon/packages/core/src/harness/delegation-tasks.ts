export * as HarnessDelegationTasks from "./delegation-tasks"

import { DateTime, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { Harness } from "@tenon/schema/harness"
import { HarnessRuntime } from "../harness"
import { Location } from "../location"
import { LocationServiceMap } from "../location-service-map"
import { AbsolutePath } from "../schema"
import { SessionV2 } from "../session"
import { SessionSchema } from "../session/schema"
import { SessionTodo } from "../session/todo"
import { HarnessAppTools } from "./app-tools"
import { HarnessDelegation } from "./delegation"

/** A delegated agent may delegate once more; deeper chains are refused. */
export const MAX_DEPTH = 2
/** Delegated tasks one Run may have running at once. */
export const MAX_RUNNING = 4
/** How often a running task checks in with the thread that delegated it. */
export const CHECK_IN_MS = 12 * 60_000
const FINISHED_RETENTION_MS = 10 * 60_000
const OUTPUT_LIMIT = 100_000
const LATEST_LIMIT = 1_500

interface Running {
  /** The thread that hears about the task; a Project lead's moves to the Command Centre thread that gave its latest goal. */
  parentID: SessionSchema.ID
  readonly agent: string
  readonly title: string
  readonly started: number
  readonly done: Promise<{ readonly error?: string }>
  cancelled: boolean
  finished: boolean
  /** Calls waiting on the result right now; one that gets it means the delegating thread needs no notice. */
  waiting: number
}

/**
 * Runs delegated tasks as child Runs of the delegating Run, so they show under it in the
 * sidebar and their approvals reach its composer. A task given a Project instead runs as a root
 * thread in that Project's folder, linked back by `origin`: it lists with the Project's threads and
 * asks for approvals in its own thread. Installed for the server's lifetime.
 */
export const layerWith = (options: { readonly checkInMs: number; readonly wakeDelayMs: number }) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const locations = yield* LocationServiceMap.Service
      const run = Effect.runPromiseWith(yield* Effect.context())
      const running = new Map<string, Running>()
      const timers = new Set<ReturnType<typeof setInterval>>()
      // Tasks a thread is starting but hasn't registered yet; counted against the limit so a batch of
      // calls can't all pass the check before any of them registers.
      const starting = new Map<string, number>()
      // Set when the server starts to shut down. This layer is released before the session runner, so tasks the
      // shutdown interrupts finish after it is set and their notices say so.
      let closing = false

      const harnesses = (session: SessionSchema.Info) =>
        Effect.gen(function* () {
          const runtime = yield* HarnessRuntime.Service
          return yield* runtime.list()
        }).pipe(Effect.provide(locations.get(session.location)))

      // A task placed in a Project has no parent; its origin counts as one, so placing can't dodge the limit. A thread
      // handed off with `thread_start` is the user's, not a task, so its origin doesn't count.
      const starter = (session: SessionSchema.Info) =>
        session.parentID ?? (session.origin?.handOff ? undefined : session.origin?.sessionID)
      // `seen` ends a cycle a hand-edited row could make; the links themselves only ever point at older threads.
      const depth = (session: SessionSchema.Info, seen = new Set<string>()): Effect.Effect<number> => {
        const from = starter(session)
        if (seen.has(session.id)) return Effect.succeed(MAX_DEPTH)
        seen.add(session.id)
        return from
          ? sessions.get(SessionSchema.ID.make(from)).pipe(
              Effect.flatMap((parent) => depth(parent, seen)),
              Effect.map((value) => value + 1),
              Effect.catch(() => Effect.succeed(1)),
            )
          : Effect.succeed(0)
      }

      const caller = (sessionID: string) =>
        Effect.gen(function* () {
          const id = decodeID(sessionID)
          if (!id) return yield* Effect.fail(new Error("The delegating thread no longer exists."))
          return yield* sessions
            .get(id)
            .pipe(Effect.mapError(() => new Error("The delegating thread no longer exists.")))
        })

      // Only the Run that started a task may read or stop it. A Project lead outlives the Command Centre thread that
      // started it, so any Command Centre thread may.
      const owned = (sessionID: string, taskID: string) =>
        Effect.gen(function* () {
          const id = decodeID(taskID)
          const child = id ? yield* sessions.get(id).pipe(Effect.option) : Option.none()
          if (Option.isSome(child) && starter(child.value) === sessionID) return child.value
          if (Option.isSome(child) && child.value.origin?.lead && (yield* fromCommandCentre(sessionID)))
            return child.value
          return yield* Effect.fail(new Error(`No delegated task ${taskID} belongs to this thread.`))
        })
      const fromCommandCentre = (sessionID: string) =>
        caller(sessionID).pipe(
          Effect.map((session) => HarnessAppTools.isCommandCentre(session.location.directory)),
          Effect.orElseSucceed(() => false),
        )

      const finalReply = (child: SessionSchema.Info, agent: string, error?: string) =>
        Effect.gen(function* () {
          const messages = yield* sessions.messages({ sessionID: child.id, order: "desc", limit: 20 })
          const reply = messages.find((message) => message.type === "assistant")
          const output = reply?.type === "assistant" ? replyText(reply.content) : undefined
          const failure = error ?? (reply?.type === "assistant" && reply.error ? errorText(reply.error) : undefined)
          const entry = running.get(child.id)
          const status = entry?.cancelled ? "cancelled" : failure || !output ? "failed" : "completed"
          return {
            taskID: child.id,
            agent,
            status,
            ...(output ? { output } : {}),
            ...(status === "failed" ? { error: failure ?? "The delegated agent ended without a reply." } : {}),
          } satisfies HarnessDelegation.TaskResult
        })

      // A delegating thread that ended its turn while a task ran would otherwise sit idle with the work half done: queue
      // it a notice, which waits for a running turn to end and wakes an idle thread.
      const notify = (
        parentID: SessionSchema.ID,
        child: SessionSchema.Info,
        agent: string,
        error: string | undefined,
        closed: boolean,
      ) =>
        Effect.gen(function* () {
          const result = yield* finalReply(child, agent, error)
          yield* sessions.prompt({
            sessionID: parentID,
            prompt: { text: finishedNotice(child.title, result, closed) },
            delivery: "queue",
          })
        })

      // A running task's checklist and latest note, so the delegating thread can tell whether it is on track. Each part
      // is left out when it can't be read.
      const stillRunning = (child: SessionSchema.Info, agent: string, started: number) =>
        Effect.gen(function* () {
          const todos = yield* Effect.gen(function* () {
            const store = yield* SessionTodo.Service
            return yield* store.get(child.id)
          }).pipe(
            Effect.provide(locations.get(child.location)),
            Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<SessionTodo.Info>)),
          )
          const messages = yield* sessions
            .messages({ sessionID: child.id, order: "desc", limit: 20 })
            .pipe(Effect.catchCause(() => Effect.succeed([])))
          const reply = messages.find((message) => message.type === "assistant")
          const latest = reply?.type === "assistant" ? lastText(reply.content) : undefined
          return {
            taskID: child.id,
            agent,
            status: "running",
            progress: {
              runningMinutes: Math.max(0, Math.floor((Date.now() - started) / 60_000)),
              ...(todos.length > 0
                ? { todos: todos.map((todo) => ({ content: todo.content, status: todo.status })) }
                : {}),
              ...(latest ? { latest } : {}),
            },
          } satisfies HarnessDelegation.TaskResult
        })

      // While a task runs, the delegating thread hears from it on an interval so it can check the work and steer it.
      // A check-in still waiting for the thread (a long turn) isn't joined by another for the same task.
      const checkIn = (child: SessionSchema.Info, entry: Running) =>
        Effect.gen(function* () {
          if (entry.finished || entry.cancelled || entry.waiting > 0) return
          const pending = yield* sessions.queued(entry.parentID)
          if (pending.some((input) => input.prompt.text.includes(checkInMarker(child.id)))) return
          yield* sessions.prompt({
            sessionID: entry.parentID,
            prompt: { text: checkInNotice(entry.title, child.id, Math.floor((Date.now() - entry.started) / 60_000)) },
            delivery: "queue",
          })
        })

      const settle = (child: SessionSchema.Info, waitSeconds: number) =>
        Effect.gen(function* () {
          const agent = child.harnessInstanceID
          const entry = running.get(child.id)
          if (!entry) {
            // Started before a restart: report what the child recorded, unless it is still running.
            if ((yield* sessions.active).has(child.id))
              return yield* stillRunning(child, agent, DateTime.toEpochMillis(child.time.created))
            return yield* finalReply(child, agent)
          }
          const outcome = yield* Effect.promise(() => {
            const waited = Promise.withResolvers<undefined>()
            const timer = setTimeout(() => waited.resolve(undefined), waitSeconds * 1_000)
            entry.waiting += 1
            // Cleared either way, so a finished task leaves no timer running for up to MAX_WAIT_SECONDS.
            return Promise.race([entry.done, waited.promise]).finally(() => {
              clearTimeout(timer)
              entry.waiting -= 1
            })
          })
          if (!outcome) return yield* stillRunning(child, agent, entry.started)
          return yield* finalReply(child, agent, outcome.error)
        })

      // The harness and model a task asks for, checked against what the workbench offers; `from` is the caller's own.
      const pick = (
        session: SessionSchema.Info,
        input: { readonly agent: string; readonly model?: string; readonly reasoningEffort?: string },
      ) =>
        Effect.gen(function* () {
          const instances = yield* harnesses(session)
          const target = instances.find((instance) => instance.id === input.agent)
          if (!target) return yield* Effect.fail(new Error(`Unknown agent ${input.agent}; call list_agents.`))
          if (target.status !== "available")
            return yield* Effect.fail(new Error(`${target.name} is not available: ${target.error ?? "not ready"}.`))
          const model = input.model ? target.models.find((item) => item.id === input.model) : undefined
          if (input.model && target.models.length > 0 && !model)
            return yield* Effect.fail(new Error(`${target.name} has no model ${input.model}; call list_agents.`))
          if (input.reasoningEffort && model && !model.reasoningEfforts.includes(input.reasoningEffort))
            return yield* Effect.fail(
              new Error(`${model.name} supports reasoning efforts: ${model.reasoningEfforts.join(", ") || "none"}.`),
            )
          return { target, from: instances.find((instance) => instance.id === session.harnessInstanceID) }
        })

      // Runs a task to the end of its work for `parentID`: check-ins while it runs, a notice when it ends.
      const track = (parentID: SessionSchema.ID, child: SessionSchema.Info, agent: string) => {
        const done: Promise<{ readonly error?: string }> = run(sessions.resume(child.id)).then(
          () => ({}),
          (cause) => ({ error: cause instanceof Error ? cause.message : String(cause) }),
        )
        const entry: Running = {
          parentID,
          agent,
          title: child.title,
          started: Date.now(),
          done,
          cancelled: false,
          finished: false,
          waiting: 0,
        }
        running.set(child.id, entry)
        const timer = setInterval(() => void run(checkIn(child, entry)).catch(() => undefined), options.checkInMs)
        timer.unref?.()
        timers.add(timer)
        void done.then((outcome) => {
          clearInterval(timer)
          timers.delete(timer)
          entry.finished = true
          // Kept a while so a late read still reports cancellation and errors; after that a read falls back to what
          // the child recorded, as after a restart. A lead given a new goal meanwhile has a new entry, which stays.
          setTimeout(() => {
            if (running.get(child.id) === entry) running.delete(child.id)
          }, FINISHED_RETENTION_MS).unref?.()
          // Runs before a waiting call's own `done` handler, so `waiting` still counts it here.
          if (entry.cancelled || entry.waiting > 0) return
          void run(notify(entry.parentID, child, agent, outcome.error, closing)).catch(() => undefined)
        })
      }

      // A Project's lead: the newest thread in its folder marked as one, found by that mark, not among recent threads.
      const findLead = (directory: string) =>
        sessions
          .list({ directory: AbsolutePath.make(directory), lead: true, order: "desc", limit: 20 })
          .pipe(Effect.map((items) => items.find((item) => !item.parentID && !item.time.archived)))
      // Finding and starting a lead is one step at a time, so goals sent together can't start two leads.
      const leadLock = Semaphore.makeUnsafe(1)

      const startLead = (session: SessionSchema.Info, directory: string, input: HarnessDelegation.LeadInput) =>
        Effect.gen(function* () {
          // Without a choice the lead runs on the Command Centre's own harness and model.
          const own = !input.agent && !input.model
          const { target } = yield* pick(session, {
            agent: input.agent ?? session.harnessInstanceID,
            model: own ? undefined : input.model,
            reasoningEffort: own ? undefined : input.reasoningEffort,
          })
          const harnessModel = own
            ? session.harnessModel
            : input.model
              ? Harness.ModelSelection.make({
                  id: input.model,
                  ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
                })
              : undefined
          return yield* sessions.create({
            origin: { sessionID: session.id, commandCentre: true, lead: true },
            title: input.title?.slice(0, 120) ?? "Project lead",
            harnessInstanceID: target.id,
            ...(harnessModel ? { harnessModel } : {}),
            location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
          })
        })

      const handler: HarnessDelegation.Handler = {
        listAgents: (sessionID) =>
          run(
            Effect.gen(function* () {
              const session = yield* caller(sessionID)
              const instances = yield* harnesses(session)
              return instances.map((instance) => ({
                id: instance.id,
                name: instance.id === Harness.OpenCode ? "Default agent" : instance.name,
                status: instance.status,
                current: instance.id === session.harnessInstanceID,
                models: instance.models.map((model) => ({
                  id: model.id,
                  name: model.name,
                  isDefault: model.isDefault,
                  reasoningEfforts: model.reasoningEfforts,
                })),
              }))
            }),
          ),
        delegate: (sessionID, input) =>
          run(
            Effect.gen(function* () {
              const session = yield* caller(sessionID)
              if ((yield* depth(session)) >= MAX_DEPTH)
                return yield* Effect.fail(new Error("Delegated agents cannot delegate further from this thread."))
              const active =
                [...running.values()].filter((entry) => entry.parentID === sessionID && !entry.finished).length +
                (starting.get(sessionID) ?? 0)
              if (active >= MAX_RUNNING)
                return yield* Effect.fail(
                  new Error(`This thread already has ${MAX_RUNNING} delegated tasks running; wait for one first.`),
                )
              // Reserved in the same step as the check, before anything yields.
              starting.set(sessionID, (starting.get(sessionID) ?? 0) + 1)
              const release = Effect.sync(() => {
                const left = (starting.get(sessionID) ?? 1) - 1
                if (left > 0) starting.set(sessionID, left)
                else starting.delete(sessionID)
              })
              const child = yield* Effect.gen(function* () {
                const { target, from } = yield* pick(session, input)
                const project = input.projectId ? yield* projectFolder(session, input.projectId) : undefined
                const child = yield* sessions.create({
                  ...(project
                    ? {
                        origin: {
                          sessionID: session.id,
                          commandCentre: HarnessAppTools.isCommandCentre(session.location.directory),
                        },
                      }
                    : { parentID: session.id }),
                  title: input.title?.slice(0, 120) ?? `${target.name}: ${input.task.split("\n")[0].slice(0, 80)}`,
                  harnessInstanceID: target.id,
                  ...(input.model
                    ? {
                        harnessModel: {
                          id: input.model,
                          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
                        },
                      }
                    : {}),
                  location: project
                    ? Location.Ref.make({ directory: AbsolutePath.make(project.directory) })
                    : session.location,
                })
                yield* sessions.prompt({
                  sessionID: child.id,
                  prompt: { text: framedTask(from?.name ?? "another agent", input.task) },
                  resume: false,
                })
                track(session.id, child, target.id)
                return child
              }).pipe(Effect.ensuring(release))
              return yield* settle(child, input.waitSeconds)
            }),
          ),
        lead: (sessionID, input) =>
          run(
            Effect.gen(function* () {
              const session = yield* caller(sessionID)
              if (!HarnessAppTools.isCommandCentre(session.location.directory))
                return yield* Effect.fail(
                  new Error(
                    "Only the Command Centre gives goals to Project leads. Use delegate_task to hand off a step of your own work.",
                  ),
                )
              const project = yield* projectFolder(session, input.projectId)
              const lead = yield* leadLock.withPermit(
                Effect.gen(function* () {
                  const current = yield* findLead(project.directory)
                  const lead = current ?? (yield* startLead(session, project.directory, input))
                  const entry = running.get(lead.id)
                  // A lead still working takes the new goal at its next safe point; an idle one starts on it.
                  const busy = (entry !== undefined && !entry.finished) || (yield* sessions.active).has(lead.id)
                  yield* sessions.prompt({
                    sessionID: lead.id,
                    prompt: { text: current ? nextGoal(input.goal) : leadBrief(input.goal) },
                    ...(busy ? { delivery: "steer" as const } : {}),
                    resume: false,
                  })
                  if (entry !== undefined && !entry.finished) entry.parentID = session.id
                  else track(session.id, lead, lead.harnessInstanceID)
                  return lead
                }),
              )
              return yield* settle(lead, input.waitSeconds)
            }),
          ),
        result: (sessionID, taskID, waitSeconds) =>
          run(
            Effect.gen(function* () {
              const child = yield* owned(sessionID, taskID)
              return yield* settle(child, waitSeconds)
            }),
          ),
        cancel: (sessionID, taskID) =>
          run(
            Effect.gen(function* () {
              const child = yield* owned(sessionID, taskID)
              const entry = running.get(child.id)
              if (entry) entry.cancelled = true
              yield* sessions.interrupt(child.id)
              return yield* settle(child, 10)
            }),
          ),
        message: (sessionID, taskID, text) =>
          run(
            Effect.gen(function* () {
              const child = yield* owned(sessionID, taskID)
              const entry = running.get(child.id)
              // Prompting a finished task would start it again, out of reach of the limit and the notices.
              if (!entry || entry.finished)
                return yield* Effect.fail(new Error(`Task ${taskID} is not running; start a new task instead.`))
              yield* sessions.prompt({
                sessionID: child.id,
                prompt: { text: `Message from the agent that delegated this task:\n\n${text}` },
                delivery: "steer",
              })
              return { taskID: child.id, sent: true as const }
            }),
          ),
      }

      // Notices queued as the last run shut down (tasks it interrupted) wait for a thread that is now idle, and
      // nothing else would wake it. Only Tenon's own notices start a turn here; a message the user queued waits for them.
      yield* Effect.sleep(options.wakeDelayMs).pipe(
        Effect.andThen(() => sessions.wakeQueued((input) => input.prompt.text.startsWith(NOTICE_PREFIX))),
        Effect.catchCause((cause) => Effect.logWarning("Could not deliver waiting task notices", { cause })),
        Effect.forkScoped,
      )

      yield* Effect.acquireRelease(
        Effect.sync(() => HarnessDelegation.install(handler)),
        (uninstall) =>
          Effect.sync(() => {
            closing = true
            uninstall()
            for (const timer of timers) clearInterval(timer)
            timers.clear()
          }),
      )
    }),
  )

// Just after launch the server's harnesses are still starting; a woken thread waits for them anyway.
export const layer = layerWith({ checkInMs: CHECK_IN_MS, wakeDelayMs: 5_000 })

function projectFolder(session: SessionSchema.Info, projectId: string) {
  return Effect.promise(() => HarnessAppTools.projectFolder({ sessionID: session.id }, projectId)).pipe(
    Effect.flatMap((folder) =>
      folder
        ? Effect.succeed(folder)
        : Effect.fail(new Error(`No Project ${projectId} is open to this thread; check the Project's id.`)),
    ),
  )
}

/**
 * The first prompt of a delegated thread. The delegate also loads the user's and the folder's instruction files,
 * which are written for a lead agent; the scope lines stop it onboarding itself on the whole repository while keeping
 * the rules that matter for the work.
 */
export function framedTask(from: string, task: string) {
  return [
    `This task was delegated to you by ${from} in Tenon Workbench. It cannot see your conversation, only your final reply,`,
    "so finish with a complete report of what you did, what you found and anything left undone.",
    "",
    "You are a delegate, not the lead agent. The brief below has the context you need:",
    "- Read only the files and docs this task needs. Don't survey the repository or read documentation beyond that.",
    "- Skip lead-agent workflow steps from instruction files (project setup, feature mapping, planning documents,",
    "  architecture diagrams, documentation upkeep) unless the brief asks for them.",
    "- Still follow the instruction files' rules on code style, safety, git, and the checks to run for the files you change.",
    "",
    task,
  ].join("\n")
}

/** A new lead's first prompt: its role, how to run the Project's work, and the goal. */
export function leadBrief(goal: string) {
  return [
    "You are this Project's lead agent in Tenon Workbench. The Command Centre gave you this goal and sends later goals to",
    "this same thread. It can't see your conversation, only your final reply.",
    "",
    "How to work:",
    "- Plan the goal into steps. Do small steps yourself. Hand larger, self-contained steps to delegates with",
    "  delegate_task (call list_agents first to pick an agent and model). Delegates run in this Project's folder as",
    "  threads under yours and can't see this conversation: give each the goal, the files and what to report back.",
    "- Up to four delegates run at once. Start them with a short wait_seconds and end your turn; Tenon tells you when",
    "  each finishes. Read the report with task_result, check the work against the goal, then start the next step.",
    "- When delegates need separate git worktrees, put them in .worktrees/<name> inside this folder and keep",
    "  .worktrees/ in .gitignore.",
    "- Ask the user only for a decision that is theirs: scope, direction, spending money, anything public or hard to undo.",
    "- Finish with a complete report: what is done and verified, what is left, and any decision the user needs to make.",
    "",
    "Goal:",
    "",
    goal,
  ].join("\n")
}

/** A later goal for a lead that already has this Project's history. */
export function nextGoal(goal: string) {
  return [
    "New goal from the Command Centre:",
    "",
    goal,
    "",
    "Plan it alongside any work still open, and finish with a complete report as before.",
  ].join("\n")
}

const NOTICE_PREFIX = "[Tenon] "

function finishedNotice(title: string, result: HarnessDelegation.TaskResult, closed: boolean) {
  const task = `${NOTICE_PREFIX}Your delegated task "${title}" (task_id ${result.taskID})`
  if (result.status === "failed" && closed)
    return [
      `${task} was interrupted because Tenon closed.`,
      "Read what it did with task_result, then start it again with the same brief and a note to pick up from its files, unless the plan has moved on.",
    ].join("\n")
  if (result.status === "failed" && /interrupted/i.test(result.error ?? ""))
    return [
      `${task} was stopped before it finished.`,
      "Read what it did with task_result. Someone stopped it, so don't start it again unless the user asks.",
    ].join("\n")
  return [
    `${task} has ${result.status === "completed" ? "finished" : "failed"}.`,
    "Read its report with task_result, then carry on with the plan: start the next step yourself, and ask the user only for a decision that is theirs to make.",
  ].join("\n")
}

const checkInMarker = (taskID: string) => `Check-in on task_id ${taskID}`

function checkInNotice(title: string, taskID: string, minutes: number) {
  return [
    `${NOTICE_PREFIX}${checkInMarker(taskID)}: your delegated task "${title}" has been running for ${minutes} minutes.`,
    "Call task_result with wait_seconds 0 to see its checklist and latest note. If it is off track, steer it with message_task (or stop it with cancel_task); if it is fine, end your turn. You will hear again when it finishes.",
  ].join("\n")
}

// The last thing the agent said, kept short: a check-in needs where it is, not its whole reply.
function lastText(content: ReadonlyArray<{ readonly type: string; readonly text?: string }>) {
  const text = content.flatMap((part) => (part.type === "text" && part.text?.trim() ? [part.text.trim()] : [])).at(-1)
  if (!text) return undefined
  return text.length <= LATEST_LIMIT ? text : `${text.slice(0, LATEST_LIMIT)}…`
}

function replyText(content: ReadonlyArray<{ readonly type: string; readonly text?: string }>) {
  const text = content
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n\n")
    .trim()
  if (!text) return undefined
  if (text.length <= OUTPUT_LIMIT) return text
  return `${text.slice(0, OUTPUT_LIMIT)}\n\n[Reply truncated at ${OUTPUT_LIMIT} characters; read the child thread for the rest.]`
}

function errorText(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string")
    return error.message
  return "The delegated agent failed."
}

const decodeID = (value: string) => Option.getOrUndefined(Schema.decodeUnknownOption(SessionSchema.ID)(value))
