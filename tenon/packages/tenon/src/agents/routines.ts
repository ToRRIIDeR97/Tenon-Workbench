export * as Routines from "./routines"

import { GlobalBus } from "@/bus/global"
import { KnowledgeVault } from "@/knowledge/vault"
import { Global } from "@tenon/core/global"
import { Effect, Schema, Semaphore } from "effect"
import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { CommandVault } from "./command-vault"

/**
 * Routines: vault pages under the workspace's `Routines/` folder whose properties carry a `schedule`
 * (`daily HH:MM`, `weekdays HH:MM`, `weekly <mon..sun> HH:MM` or a five-field cron) and optionally
 * `enabled`, `harness`, `model`, `tools` and `timeout` (minutes). The page body is the prompt a Command
 * Centre thread runs.
 *
 * When each routine last ran lives in this machine's app data (`routines-state.json`), never in the
 * vault: it is a cache, and a lost file only means the next scheduled time is the new baseline. The same
 * file keeps the Command Centre's default model as the renderer last sent it, for scheduled runs.
 *
 * `harness` and `tools` are read but not honoured yet: every run uses the Tenon harness and its tools, and
 * the Routines page says so on the row.
 *
 * A routine runs unattended with the Command Centre's tools, and anything that can write the vault folder
 * can write a page. So a page runs only once the user has approved what it would run: the state file keeps
 * the approved content's hash, and any change to it needs approving again, on each machine.
 */

export const Info = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  schedule: Schema.String,
  enabled: Schema.Boolean,
  nextRun: Schema.NullOr(Schema.String),
  lastRun: Schema.NullOr(Schema.String),
  /** `unfiled`: the run finished but its reply stayed in its thread, out of `Inbox.md`. */
  lastStatus: Schema.NullOr(Schema.Literals(["running", "done", "failed", "unfiled"])),
  /** Front-matter properties the page sets that runs don't honour yet (`harness`, `tools`). */
  unsupported: Schema.Array(Schema.String),
  /** The hash of what the page would run; `approve` takes it back, so a page changed since isn't approved. */
  hash: Schema.String,
  /** This content isn't approved: it won't run on schedule or from Run now. */
  needsApproval: Schema.Boolean,
  /** Permissions the last run wanted and was refused, because nobody could answer. */
  denied: Schema.Array(Schema.String),
})
export type Info = typeof Info.Type

export const RunResult = Schema.Struct({ threadId: Schema.String })

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Routines.NotFoundError", {
  id: Schema.String,
}) {}

/** Run now on an unapproved routine, or an approval of content that has changed since it was listed. */
export class ApprovalError extends Schema.TaggedErrorClass<ApprovalError>()("Routines.ApprovalError", {
  id: Schema.String,
}) {}

/** A Run now while the routine's last run is still in flight. */
export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("Routines.ConflictError", {
  id: Schema.String,
}) {}

/** `routines-state.json` could not be written. */
export class StateError extends Schema.TaggedErrorClass<StateError>()("Routines.StateError", {}) {}

/** A routine as `run` receives it. */
export interface Routine {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly schedule: string
  readonly enabled: boolean
  readonly prompt: string
  readonly harness?: string
  readonly model?: string
  readonly tools?: ReadonlyArray<string>
  /** Minutes a run may take; a longer run is stopped and marked failed. */
  readonly timeout?: number
}

type Reply = { text: string; denied?: ReadonlyArray<string> }
export type Run<E = never, R = never> = (routine: Routine) => Effect.Effect<Reply & { threadId: string }, E, R>

/** The top-level vault folder routines live in, in any letter case. */
export const folder = "Routines"
/** Whether a vault page path is one the scheduler reads as a routine, in any case. */
export const isRoutinePath = (page: string) => page.toLowerCase().startsWith(`${folder.toLowerCase()}/`)
const inbox = "Inbox.md"
// Past this size the Inbox's entries move to `Inbox/<YYYY-MM>.md`. A full Inbox would refuse every reply at
// the 5 MB page limit, and each append keeps a copy in `.history`, so a smaller page is also cheaper.
const inboxLimit = 1024 * 1024
const defaultTimeout = 120
const maxTimeout = 24 * 60
const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

// ---------------------------------------------------------------------------------------------
// Schedules

type Field = ReadonlySet<number> | undefined // undefined: any value ("*")
type Cron = { minute: Field; hour: Field; day: Field; month: Field; weekday: Field }

function field(source: string, min: number, max: number): Field {
  if (source === "*") return undefined
  const values = new Set<number>()
  for (const part of source.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!match) throw new Error(`Invalid schedule field: ${source}`)
    const step = match[4] === undefined ? 1 : Number(match[4])
    const start = match[1] === "*" ? min : Number(match[2])
    const end =
      match[1] === "*" ? max : match[3] === undefined ? (match[4] === undefined ? start : max) : Number(match[3])
    if (step < 1 || start < min || end > max || start > end) throw new Error(`Invalid schedule field: ${source}`)
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values
}

function time(source: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(source)
  if (!match) throw new Error(`Invalid time: ${source}`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new Error(`Invalid time: ${source}`)
  return { hour, minute }
}

/** Parse a schedule into cron fields; throws on an unknown form. */
export function parse(schedule: string): Cron {
  const words = schedule.trim().toLowerCase().split(/\s+/)
  if (words[0] === "daily" && words.length === 2) return cron(words[1], "*")
  if (words[0] === "weekdays" && words.length === 2) return cron(words[1], "1-5")
  if (words[0] === "weekly" && words.length === 3) {
    const day = days.indexOf(words[1].slice(0, 3))
    if (day === -1) throw new Error(`Invalid day: ${words[1]}`)
    return cron(words[2], String(day))
  }
  if (words.length !== 5) throw new Error(`Invalid schedule: ${schedule}`)
  const weekday = field(words[4], 0, 7)
  return {
    minute: field(words[0], 0, 59),
    hour: field(words[1], 0, 23),
    day: field(words[2], 1, 31),
    month: field(words[3], 1, 12),
    // Cron allows 7 for Sunday.
    weekday: weekday && new Set([...weekday].map((value) => value % 7)),
  }
}

function cron(clock: string, weekday: string): Cron {
  const { hour, minute } = time(clock)
  return {
    minute: new Set([minute]),
    hour: new Set([hour]),
    day: undefined,
    month: undefined,
    weekday: field(weekday, 0, 6),
  }
}

const has = (set: Field, value: number) => set === undefined || set.has(value)

function dayMatches(spec: Cron, date: Date) {
  // Cron: when both day-of-month and day-of-week are restricted, either one matching is enough.
  if (spec.day !== undefined && spec.weekday !== undefined)
    return spec.day.has(date.getDate()) || spec.weekday.has(date.getDay())
  return has(spec.day, date.getDate()) && has(spec.weekday, date.getDay())
}

/** The first scheduled local time strictly after `after`. Throws on an invalid schedule. */
export function nextRun(schedule: string, after: Date): Date {
  const spec = parse(schedule)
  const date = new Date(after.getTime())
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() + 1)
  // Five years covers every valid cron (29 February included); jumps keep the walk short.
  const limit = after.getTime() + 5 * 366 * 24 * 60 * 60 * 1000
  while (date.getTime() <= limit) {
    if (!has(spec.month, date.getMonth() + 1)) {
      date.setMonth(date.getMonth() + 1, 1)
      date.setHours(0, 0, 0, 0)
      continue
    }
    if (!dayMatches(spec, date)) {
      date.setDate(date.getDate() + 1)
      date.setHours(0, 0, 0, 0)
      continue
    }
    if (!has(spec.hour, date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!has(spec.minute, date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1, 0, 0)
      continue
    }
    return date
  }
  throw new Error(`Schedule never runs: ${schedule}`)
}

function safeNextRun(schedule: string, after: Date) {
  try {
    return nextRun(schedule, after)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------------------------
// Run state (app data, machine-local)

type State = {
  /** Schedule baseline: when the routine was first seen, or last enabled or disabled. */
  firstSeen?: number
  /** The start of the last finished run, however it ended. */
  lastRun?: number
  lastStatus?: "running" | "done" | "failed" | "unfiled"
  /** The start of the run in flight. */
  startedAt?: number
  /** Whether the routine could run at the last check (on and approved), so a change moves the baseline. */
  enabled?: boolean
  /** The hash of the content the user approved. */
  approved?: string
  /** Permissions the last finished run was refused. */
  denied?: ReadonlyArray<string>
}
type ModelChoice = { providerID: string; modelID: string }
type StateFile = { version: 1; routines: Record<string, State>; defaultModel?: ModelChoice }

const stateLock = Semaphore.makeUnsafe(1)
const inboxLock = Semaphore.makeUnsafe(1)
const stateFile = () => path.join(Global.make().data, "routines-state.json")

const readState = Effect.promise(async (): Promise<StateFile> => {
  const source = await readFile(stateFile(), "utf8").catch(() => undefined)
  if (!source) return { version: 1, routines: {} }
  try {
    const parsed = JSON.parse(source) as StateFile
    return parsed && parsed.version === 1 && typeof parsed.routines === "object" ? parsed : { version: 1, routines: {} }
  } catch {
    return { version: 1, routines: {} }
  }
})

const writeState = (state: StateFile) =>
  Effect.tryPromise({
    try: async () => {
      const file = stateFile()
      await mkdir(path.dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify(state, null, 2) + "\n")
      await rename(temp, file)
    },
    catch: () => new StateError(),
  })

const updateState = (key: string, change: (current: State) => State) =>
  stateLock.withPermits(1)(
    Effect.gen(function* () {
      const state = yield* readState
      const current = state.routines[key] ?? {}
      const next = change(current)
      // Every check of every routine lands here each minute, nearly always with nothing to record.
      if (isDeepStrictEqual(next, current)) return current
      state.routines[key] = next
      yield* writeState(state)
      return next
    }),
  )

/** How long a run may take, in milliseconds. */
const timeoutOf = (routine: Routine) => (routine.timeout ?? defaultTimeout) * 60_000

/**
 * A run past its limit never ended (its timeout should have ended it), so it no longer counts as in flight.
 * The extra minute lets a timeout that is firing right now record its own result first.
 */
const inFlight = (state: State, limit: number, now: Date) =>
  state.lastStatus === "running" && now.getTime() - (state.startedAt ?? 0) <= limit + 60_000

/** Mark a run started when `due` holds on the current state; false when it doesn't or one is in flight. */
const claim = (key: string, now: Date, limit: number, due: (current: State) => boolean) =>
  stateLock.withPermits(1)(
    Effect.gen(function* () {
      const state = yield* readState
      const current = state.routines[key] ?? {}
      if (inFlight(current, limit, now) || !due(current)) return false
      state.routines[key] = { ...current, startedAt: now.getTime(), lastStatus: "running" }
      yield* writeState(state)
      return true
    }),
  )

/**
 * Mark runs no process finished (the app quit or crashed mid-run) as failed. Their `lastRun` is unchanged,
 * so the missed time runs again on the next check. The scheduler calls it once when it starts.
 */
export const recoverInterrupted = stateLock.withPermits(1)(
  Effect.gen(function* () {
    const state = yield* readState
    const stale = Object.keys(state.routines).filter((key) => state.routines[key].lastStatus === "running")
    if (stale.length === 0) return 0
    for (const key of stale)
      state.routines[key] = { ...state.routines[key], lastStatus: "failed", startedAt: undefined }
    yield* writeState(state)
    return stale.length
  }),
)

/** The Command Centre's default model as the renderer last sent it; scheduled runs fall back to it. */
export const defaultModel = readState.pipe(Effect.map((state) => state.defaultModel))

/** Remember the Command Centre's default model; none clears it. */
export const rememberDefaultModel = (model: ModelChoice | undefined) =>
  stateLock.withPermits(1)(
    Effect.gen(function* () {
      const state = yield* readState
      if (state.defaultModel?.providerID === model?.providerID && state.defaultModel?.modelID === model?.modelID) return
      yield* writeState({ ...state, defaultModel: model })
    }),
  )

const stateKey = (vault: KnowledgeVault.Vault, id: string) => `${vault.id}/${id}`

// ---------------------------------------------------------------------------------------------
// Routines in the vault

function routineFrom(page: KnowledgeVault.Page): Routine | undefined {
  const properties = page.info.properties
  const schedule = typeof properties.schedule === "string" ? properties.schedule.trim() : ""
  if (!schedule) return undefined
  const tools = Array.isArray(properties.tools)
    ? properties.tools.filter((item): item is string => typeof item === "string")
    : undefined
  return {
    id: page.info.id,
    name: page.info.title || path.posix.basename(page.info.path, ".md"),
    path: page.info.path,
    schedule,
    enabled: properties.enabled !== false,
    prompt: page.body,
    ...(typeof properties.harness === "string" ? { harness: properties.harness } : {}),
    ...(typeof properties.model === "string" ? { model: properties.model } : {}),
    ...(tools ? { tools } : {}),
    ...(typeof properties.timeout === "number" && properties.timeout > 0
      ? { timeout: Math.min(properties.timeout, maxTimeout) }
      : {}),
  }
}

const routinesIn = Effect.fnUntraced(function* (vault: KnowledgeVault.Vault) {
  const pages = yield* KnowledgeVault.folderPages(vault, folder)
  return pages
    .filter((page) => page.info.projectId === null)
    .map(routineFrom)
    .filter((routine): routine is Routine => routine !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name))
})

/** What a run depends on. `enabled` is out: turning a routine off and on changes nothing it would do. */
const contentHash = (routine: Routine) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        routine.prompt,
        routine.schedule,
        routine.model,
        routine.harness,
        routine.tools,
        routine.timeout,
      ]),
    )
    .digest("hex")

const describe = (routine: Routine, state: State, now: Date): Info => {
  const next = safeNextRun(routine.schedule, now)
  const hash = contentHash(routine)
  return {
    id: routine.id,
    name: routine.name,
    path: routine.path,
    schedule: routine.schedule,
    enabled: routine.enabled,
    nextRun: next ? next.toISOString() : null,
    lastRun: state.lastRun === undefined ? null : new Date(state.lastRun).toISOString(),
    // A run that never ended reads as failed, so Run now is offered again.
    lastStatus:
      state.lastStatus === "running" && !inFlight(state, timeoutOf(routine), now)
        ? "failed"
        : (state.lastStatus ?? null),
    unsupported: [
      routine.harness && routine.harness !== "opencode" ? "harness" : undefined,
      routine.tools ? "tools" : undefined,
    ].filter((item): item is string => item !== undefined),
    hash,
    needsApproval: state.approved !== hash,
    denied: state.denied ?? [],
  }
}

/** The current workspace's routines with their next and last runs. */
export const list = Effect.fn("Routines.list")(function* (now: Date = new Date()) {
  return yield* CommandVault.withVault((vault) =>
    Effect.gen(function* () {
      const routines = yield* routinesIn(vault)
      const state = yield* readState
      return routines.map((routine) => describe(routine, state.routines[stateKey(vault, routine.id)] ?? {}, now))
    }),
  )
})

/** Record the user's approval of a routine's content; refused when `hash` is no longer what the page holds. */
export const approve = Effect.fn("Routines.approve")(function* (input: { id: string; hash: string }) {
  return yield* CommandVault.withVault((vault) =>
    Effect.gen(function* () {
      const routine = (yield* routinesIn(vault)).find((item) => item.id === input.id)
      if (!routine) return yield* new NotFoundError({ id: input.id })
      if (contentHash(routine) !== input.hash) return yield* new ApprovalError({ id: input.id })
      yield* updateState(stateKey(vault, routine.id), (current) => ({ ...current, approved: input.hash }))
    }),
  )
})

/** Move a full Inbox's text to `Inbox/<YYYY-MM>.md`, or `-2`, `-3`... when a month fills more than one. */
const archiveInbox = Effect.fnUntraced(function* (vault: KnowledgeVault.Vault, body: string, at: Date) {
  const month = at.toISOString().slice(0, 7)
  for (let part = 1; ; part++) {
    const name = part === 1 ? month : `${month}-${part}`
    const created = yield* KnowledgeVault.writePage(vault, `Inbox/${name}.md`, {
      body,
      title: `Inbox ${name}`,
      create: true,
    }).pipe(
      Effect.as(true),
      Effect.catchTag("KnowledgeVault.ConflictError", () => Effect.succeed(false)),
    )
    if (created) return
  }
})

/**
 * Append a run's reply to the workspace's `Inbox.md` vault page, creating it when missing and first moving
 * its entries to an archive page when it is full. True once the reply is in. The archive page is written
 * before the Inbox is emptied, so a failure in between leaves a duplicate, never a gap.
 */
const appendInbox = Effect.fnUntraced(function* (
  vault: KnowledgeVault.Vault,
  routine: Routine,
  text: string,
  at: Date,
) {
  const entry = `## ${routine.name} · ${at.toISOString()}\n\n${text.trim()}\n`
  const fresh = `# Inbox\n\n${entry}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = yield* KnowledgeVault.readPage(vault, inbox).pipe(
      Effect.catchTag("KnowledgeVault.NotFoundError", () => Effect.succeed(undefined)),
    )
    const full =
      current !== undefined && Buffer.byteLength(current.body, "utf8") + Buffer.byteLength(entry, "utf8") > inboxLimit
    if (full) yield* archiveInbox(vault, current.body, at)
    const written = yield* (
      current
        ? KnowledgeVault.writePage(vault, inbox, {
            body: full ? fresh : `${current.body.replace(/\s+$/, "")}\n\n${entry}`,
            expectedRevision: current.revision,
          })
        : KnowledgeVault.writePage(vault, inbox, { body: fresh, title: "Inbox", create: true })
    ).pipe(
      Effect.as(true),
      Effect.catchTag("KnowledgeVault.ConflictError", () => Effect.succeed(false)),
    )
    if (written) return true
  }
  yield* Effect.logWarning("Routine result was not added to the Inbox after three attempts", { routine: routine.id })
  return false
})

/**
 * Run one routine whose start is already recorded (`claim` or `runNow`), then record the run, file its reply
 * in the Inbox and announce it. `lastRun` is written only once the run ends, however it ended. A run past
 * its timeout is interrupted and counts as failed, so a hung thread can't hold the routine. A reply that can't be filed stays in its thread and the routine shows `unfiled`.
 */
const runOne = Effect.fnUntraced(function* <E, R>(
  vault: KnowledgeVault.Vault,
  routine: Routine,
  run: Run<E, R>,
  now: Date,
) {
  const key = stateKey(vault, routine.id)
  // A lost write leaves the run "running" until `claim` calls it stale.
  const finish = (status: "done" | "failed" | "unfiled", denied?: ReadonlyArray<string>) =>
    updateState(key, (current) => ({
      ...current,
      lastRun: now.getTime(),
      lastStatus: status,
      startedAt: undefined,
      denied,
    })).pipe(
      Effect.catchTag("Routines.StateError", () =>
        Effect.logWarning("Routine result was not recorded", { routine: routine.id }),
      ),
    )
  const result = yield* run(routine).pipe(
    Effect.timeout(timeoutOf(routine)),
    Effect.catchCause((cause) =>
      Effect.logWarning("Routine run failed", { routine: routine.id, cause }).pipe(Effect.as(undefined)),
    ),
  )
  if (!result) {
    yield* finish("failed")
    return undefined
  }
  // Serial, so routines finishing together don't use up each other's retries.
  const filed = yield* inboxLock
    .withPermits(1)(appendInbox(vault, routine, result.text, now))
    .pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Routine Inbox append failed", { routine: routine.id, cause }).pipe(Effect.as(false)),
      ),
    )
  yield* finish(filed ? "done" : "unfiled", result.denied)
  GlobalBus.emit("event", {
    payload: { type: "routine.finished", properties: { routineId: routine.id, threadId: result.threadId } },
  })
  return result
})

/**
 * Run every enabled routine whose schedule had a time after its last run (or, never run, after the first
 * `runDue` that saw it, or after it was last enabled, disabled or approved) and at or before `now`. Each runs at most
 * once however many times were missed, and at most one run of a routine is in flight. Due routines run
 * concurrently; the state is re-read under the lock before each starts, so a Run now is seen.
 */
export const runDue = Effect.fn("Routines.runDue")(function* <E, R>(input: { now: Date; run: Run<E, R> }) {
  return yield* CommandVault.withVault((vault) =>
    Effect.gen(function* () {
      const routines = yield* routinesIn(vault)
      const at = input.now.getTime()
      const ran = yield* Effect.forEach(
        routines,
        (routine) =>
          Effect.gen(function* () {
            const key = stateKey(vault, routine.id)
            // A routine never seen, or that started or stopped being able to run since the last check, takes
            // now as its baseline, so neither approving nor enabling one runs a missed time.
            const hash = contentHash(routine)
            let baseline = false
            let runnable = false
            yield* updateState(key, (current) => {
              runnable = routine.enabled && current.approved === hash
              baseline =
                (current.firstSeen === undefined && current.lastRun === undefined) ||
                (current.enabled !== undefined && current.enabled !== runnable)
              return { ...current, enabled: runnable, ...(baseline ? { firstSeen: at } : {}) }
            })
            if (baseline || !runnable) return undefined
            const claimed = yield* claim(key, input.now, timeoutOf(routine), (current) => {
              const since = Math.max(current.lastRun ?? -Infinity, current.firstSeen ?? -Infinity)
              const next = Number.isFinite(since) ? safeNextRun(routine.schedule, new Date(since)) : undefined
              return next !== undefined && next.getTime() <= at
            })
            if (!claimed) return undefined
            yield* runOne(vault, routine, input.run, input.now)
            return routine.id
          }).pipe(
            // One routine's state failure leaves the others running.
            Effect.catchTag("Routines.StateError", () =>
              Effect.logWarning("Routine check failed", { routine: routine.id }).pipe(Effect.as(undefined)),
            ),
          ),
        { concurrency: "unbounded" },
      )
      return { ran: ran.filter((id): id is string => id !== undefined) }
    }),
  )
})

/**
 * Start a routine now. `start` creates the thread and returns its id with the reply still to come; the
 * reply is then filed in the background. Resolves once the thread exists. Fails with `ApprovalError` when the page
 * isn't approved and `ConflictError` while a run of the routine is in flight.
 */
export const runNow = Effect.fn("Routines.runNow")(function* <E, R, E2, R2>(input: {
  id: string
  start: (routine: Routine) => Effect.Effect<{ threadId: string; reply: Effect.Effect<Reply, E2, R2> }, E, R>
}) {
  return yield* CommandVault.withVault((vault) =>
    Effect.gen(function* () {
      const routine = (yield* routinesIn(vault)).find((item) => item.id === input.id)
      if (!routine) return yield* new NotFoundError({ id: input.id })
      const key = stateKey(vault, routine.id)
      const hash = contentHash(routine)
      const now = new Date()
      // Not consulted while a run is in flight, so that case stays a `ConflictError`.
      let approved = true
      const claimed = yield* claim(key, now, timeoutOf(routine), (current) => (approved = current.approved === hash))
      if (!approved) return yield* new ApprovalError({ id: routine.id })
      if (!claimed) return yield* new ConflictError({ id: input.id })
      const started = yield* input.start(routine).pipe(
        Effect.tapCause(() =>
          updateState(key, (current) => ({
            ...current,
            lastRun: now.getTime(),
            lastStatus: "failed",
            startedAt: undefined,
          })).pipe(Effect.ignore),
        ),
      )
      yield* runOne(
        vault,
        routine,
        () => started.reply.pipe(Effect.map((reply) => ({ threadId: started.threadId, ...reply }))),
        now,
      ).pipe(Effect.forkDetach)
      return { threadId: started.threadId }
    }),
  )
})
