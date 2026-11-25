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

export const Info = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  schedule: Schema.String,
  enabled: Schema.Boolean,
  nextRun: Schema.NullOr(Schema.String),
  lastRun: Schema.NullOr(Schema.String),
  lastStatus: Schema.NullOr(Schema.Literals(["running", "done", "failed", "unfiled"])),
  unsupported: Schema.Array(Schema.String),
  hash: Schema.String,
  needsApproval: Schema.Boolean,
  denied: Schema.Array(Schema.String),
})
export type Info = typeof Info.Type

export const RunResult = Schema.Struct({ threadId: Schema.String })

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Routines.NotFoundError", {
  id: Schema.String,
}) {}

export class ApprovalError extends Schema.TaggedError<ApprovalError>()("Routines.ApprovalError", {
  id: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()("Routines.ConflictError", {
  id: Schema.String,
}) {}

export class StateError extends Schema.TaggedError<StateError>()("Routines.StateError", {}) {}

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
  readonly timeout?: number
}

type Reply = { text: string; denied?: ReadonlyArray<string> }
export type Run<E = never, R = never> = (routine: Routine) => Effect.Effect<Reply & { threadId: string }, E, R>

export const folder = "Routines"
export const isRoutinePath = (page: string) => page.toLowerCase().startsWith(`${folder.toLowerCase()}/`)
const inbox = "Inbox.md"
const inboxLimit = 1024 * 1024
const defaultTimeout = 120
const maxTimeout = 24 * 60
const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

type Field = ReadonlySet<number> | undefined
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
  if (spec.day !== undefined && spec.weekday !== undefined)
    return spec.day.has(date.getDate()) || spec.weekday.has(date.getDay())
  return has(spec.day, date.getDate()) && has(spec.weekday, date.getDay())
}

export function nextRun(schedule: string, after: Date): Date {
  const spec = parse(schedule)
  const date = new Date(after.getTime())
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() + 1)
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

type State = {
  firstSeen?: number
  lastRun?: number
  lastStatus?: "running" | "done" | "failed" | "unfiled"
  startedAt?: number
  enabled?: boolean
  approved?: string
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
      if (isDeepStrictEqual(next, current)) return current
      state.routines[key] = next
      yield* writeState(state)
      return next
    }),
  )

const timeoutOf = (routine: Routine) => (routine.timeout ?? defaultTimeout) * 60_000

const inFlight = (state: State, limit: number, now: Date) =>
  state.lastStatus === "running" && now.getTime() - (state.startedAt ?? 0) <= limit + 60_000

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

export const defaultModel = readState.pipe(Effect.map((state) => state.defaultModel))

export const rememberDefaultModel = (model: ModelChoice | undefined) =>
  stateLock.withPermits(1)(
    Effect.gen(function* () {
      const state = yield* readState
      if (state.defaultModel?.providerID === model?.providerID && state.defaultModel?.modelID === model?.modelID) return
      yield* writeState({ ...state, defaultModel: model })
    }),
  )

const stateKey = (vault: KnowledgeVault.Vault, id: string) => `${vault.id}/${id}`

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

export const list = Effect.fn("Routines.list")(function* (now: Date = new Date()) {
  return yield* CommandVault.withVault((vault) =>
    Effect.gen(function* () {
      const routines = yield* routinesIn(vault)
      const state = yield* readState
      return routines.map((routine) => describe(routine, state.routines[stateKey(vault, routine.id)] ?? {}, now))
    }),
  )
})

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

const runOne = Effect.fnUntraced(function* <E, R>(
  vault: KnowledgeVault.Vault,
  routine: Routine,
  run: Run<E, R>,
  now: Date,
) {
  const key = stateKey(vault, routine.id)
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
