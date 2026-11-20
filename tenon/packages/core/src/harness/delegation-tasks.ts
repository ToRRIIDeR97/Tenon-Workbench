export * as HarnessDelegationTasks from "./delegation-tasks"

import { Effect, Layer, Option, Schema } from "effect"
import { Harness } from "@tenon/schema/harness"
import { HarnessRuntime } from "../harness"
import { Location } from "../location"
import { LocationServiceMap } from "../location-service-map"
import { AbsolutePath } from "../schema"
import { SessionV2 } from "../session"
import { SessionSchema } from "../session/schema"
import { HarnessAppTools } from "./app-tools"
import { HarnessDelegation } from "./delegation"

/** A delegated agent may delegate once more; deeper chains are refused. */
export const MAX_DEPTH = 2
/** Delegated tasks one Run may have running at once. */
export const MAX_RUNNING = 4
const FINISHED_RETENTION_MS = 10 * 60_000
const OUTPUT_LIMIT = 100_000

interface Running {
  readonly parentID: string
  readonly agent: string
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
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const locations = yield* LocationServiceMap.Service
    const run = Effect.runPromiseWith(yield* Effect.context())
    const running = new Map<string, Running>()
    // Tasks a thread is starting but hasn't registered yet; counted against the limit so a batch of
    // calls can't all pass the check before any of them registers.
    const starting = new Map<string, number>()

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
        return yield* sessions.get(id).pipe(Effect.mapError(() => new Error("The delegating thread no longer exists.")))
      })

    // Only the Run that started a task may read or stop it.
    const owned = (sessionID: string, taskID: string) =>
      Effect.gen(function* () {
        const id = decodeID(taskID)
        const child = id ? yield* sessions.get(id).pipe(Effect.option) : Option.none()
        if (Option.isNone(child) || starter(child.value) !== sessionID)
          return yield* Effect.fail(new Error(`No delegated task ${taskID} belongs to this thread.`))
        return child.value
      })

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
    const notify = (parentID: SessionSchema.ID, child: SessionSchema.Info, agent: string, error?: string) =>
      Effect.gen(function* () {
        const result = yield* finalReply(child, agent, error)
        yield* sessions.prompt({
          sessionID: parentID,
          prompt: { text: finishedNotice(child.title, result) },
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
            return { taskID: child.id, agent, status: "running" } satisfies HarnessDelegation.TaskResult
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
        if (!outcome) return { taskID: child.id, agent, status: "running" } satisfies HarnessDelegation.TaskResult
        return yield* finalReply(child, agent, outcome.error)
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
                  new Error(
                    `${model.name} supports reasoning efforts: ${model.reasoningEfforts.join(", ") || "none"}.`,
                  ),
                )
              const from = instances.find((instance) => instance.id === session.harnessInstanceID)
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
              const done: Promise<{ readonly error?: string }> = run(sessions.resume(child.id)).then(
                () => ({}),
                (cause) => ({ error: cause instanceof Error ? cause.message : String(cause) }),
              )
              const entry: Running = {
                parentID: sessionID,
                agent: target.id,
                done,
                cancelled: false,
                finished: false,
                waiting: 0,
              }
              running.set(child.id, entry)
              void done.then((outcome) => {
                entry.finished = true
                // Kept a while so a late read still reports cancellation and errors; after that a read
                // falls back to what the child recorded, as after a restart.
                setTimeout(() => running.delete(child.id), FINISHED_RETENTION_MS).unref?.()
                // Runs before a waiting call's own `done` handler, so `waiting` still counts it here.
                if (entry.cancelled || entry.waiting > 0) return
                void run(notify(session.id, child, target.id, outcome.error)).catch(() => undefined)
              })
              return child
            }).pipe(Effect.ensuring(release))
            return yield* settle(child, input.waitSeconds)
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
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => HarnessDelegation.install(handler)),
      (uninstall) => Effect.sync(uninstall),
    )
  }),
)

function projectFolder(session: SessionSchema.Info, projectId: string) {
  return Effect.promise(() => HarnessAppTools.projectFolder({ sessionID: session.id }, projectId)).pipe(
    Effect.flatMap((folder) =>
      folder
        ? Effect.succeed(folder)
        : Effect.fail(new Error(`No Project ${projectId} is open to this thread; check the Project's id.`)),
    ),
  )
}

function framedTask(from: string, task: string) {
  return [
    `This task was delegated to you by ${from} in Tenon Workbench. It cannot see your conversation, only your final reply,`,
    "so finish with a complete report of what you did, what you found and anything left undone.",
    "",
    task,
  ].join("\n")
}

function finishedNotice(title: string, result: HarnessDelegation.TaskResult) {
  return [
    `[Tenon] Your delegated task "${title}" (task_id ${result.taskID}) has ${result.status === "completed" ? "finished" : "failed"}.`,
    "Read its report with task_result, then carry on with the plan: start the next step yourself, and ask the user only for a decision that is theirs to make.",
  ].join("\n")
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
