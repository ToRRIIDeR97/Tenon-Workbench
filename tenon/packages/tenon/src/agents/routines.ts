export * as Routines from "./routines"

import { GlobalBus } from "@/bus/global"
import { KnowledgeVault } from "@/knowledge/vault"
import { Global } from "@tenon/core/global"
import { Effect, Schema, Semaphore } from "effect"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { CommandVault } from "./command-vault"

/**
 * Routines: vault pages under the workspace's `Routines/` folder whose properties carry a `schedule`
 * (`daily HH:MM`, `weekdays HH:MM`, `weekly <mon..sun> HH:MM` or a five-field cron) and optionally
 * `enabled`, `harness`, `model` and `tools`. The page body is the prompt a Command Centre thread runs.
 *
 * When each routine last ran lives in this machine's app data (`routines-state.json`), never in the
 * vault: it is a cache, and a lost file only means the next scheduled time is the new baseline.
 */

export const Info = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  schedule: Schema.String,
  enabled: Schema.Boolean,
  nextRun: Schema.NullOr(Schema.String),
  lastRun: Schema.NullOr(Schema.String),
  lastStatus: Schema.NullOr(Schema.Literals(["running", "done", "failed"])),
})
export type Info = typeof Info.Type

export const RunResult = Schema.Struct({ threadId: Schema.String })

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Routines.NotFoundError", {
  id: Schema.String,
}) {}

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
}

export type Run<E = never, R = never> = (routine: Routine) => Effect.Effect<{ threadId: string; text: string }, E, R>

const folder = "Routines/"
const inbox = "Inbox.md"
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

type State = { firstSeen?: number; lastRun?: number; lastStatus?: "running" | "done" | "failed" }
type StateFile = { version: 1; routines: Record<string, State> }

const stateLock = Semaphore.makeUnsafe(1)
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
  Effect.promise(async () => {
    const file = stateFile()
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(state, null, 2) + "\n")
    await rename(temp, file)
  })

const updateState = (key: string, change: (current: State) => State) =>
  stateLock.withPermits(1)(
    Effect.gen(function* () {
      const state = yield* readState
      state.routines[key] = change(state.routines[key] ?? {})
      yield* writeState(state)
      return state.routines[key]
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
  }
}

const routinesIn = Effect.fnUntraced(function* (vault: KnowledgeVault.Vault) {
  const pages = yield* KnowledgeVault.listPages(vault)
  const routines = yield* Effect.forEach(
    pages.filter((page) => page.projectId === null && page.path.toLowerCase().startsWith(folder.toLowerCase())),
    (info) =>
      KnowledgeVault.readPage(vault, info.path).pipe(
        Effect.map(routineFrom),
        Effect.catch(() => Effect.succeed(undefined)),
      ),
    { concurrency: 8 },
  )
  return routines
    .filter((routine): routine is Routine => routine !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name))
})

const describe = (routine: Routine, state: State, now: Date): Info => {
  const next = safeNextRun(routine.schedule, now)
  return {
    id: routine.id,
    name: routine.name,
    path: routine.path,
    schedule: routine.schedule,
    enabled: routine.enabled,
    nextRun: next ? next.toISOString() : null,
    lastRun: state.lastRun === undefined ? null : new Date(state.lastRun).toISOString(),
    lastStatus: state.lastStatus ?? null,
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

/** Append a run's reply to the workspace's `Inbox.md` vault page, creating it when missing. */
const appendInbox = Effect.fnUntraced(function* (
  vault: KnowledgeVault.Vault,
  routine: Routine,
  text: string,
  at: Date,
) {
  const entry = `## ${routine.name} · ${at.toISOString()}\n\n${text.trim()}\n`
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = yield* KnowledgeVault.readPage(vault, inbox).pipe(
      Effect.catchTag("KnowledgeVault.NotFoundError", () => Effect.succeed(undefined)),
    )
    const written = yield* (
      current
        ? KnowledgeVault.writePage(vault, inbox, {
            body: `${current.body.replace(/\s+$/, "")}\n\n${entry}`,
            expectedRevision: current.revision,
          })
        : KnowledgeVault.writePage(vault, inbox, { body: `# Inbox\n\n${entry}`, title: "Inbox", create: true })
    ).pipe(
      Effect.as(true),
      Effect.catchTag("KnowledgeVault.ConflictError", () => Effect.succeed(false)),
    )
    if (written) return
  }
  yield* Effect.logWarning("Routine result was not added to the Inbox after three attempts", { routine: routine.id })
})

/** Run one routine now, record the run, file its reply in the Inbox and announce it. */
const runOne = Effect.fnUntraced(function* <E, R>(
  vault: KnowledgeVault.Vault,
  routine: Routine,
  run: Run<E, R>,
  now: Date,
) {
  const key = stateKey(vault, routine.id)
  yield* updateState(key, (current) => ({ ...current, lastRun: now.getTime(), lastStatus: "running" }))
  const result = yield* run(routine).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Routine run failed", { routine: routine.id, cause }).pipe(Effect.as(undefined)),
    ),
  )
  if (!result) {
    yield* updateState(key, (current) => ({ ...current, lastStatus: "failed" }))
    return undefined
  }
  yield* appendInbox(vault, routine, result.text, now).pipe(
    Effect.catchCause((cause) => Effect.logWarning("Routine Inbox append failed", { routine: routine.id, cause })),
  )
  yield* updateState(key, (current) => ({ ...current, lastStatus: "done" }))
  GlobalBus.emit("event", {
    payload: { type: "routine.finished", properties: { routineId: routine.id, threadId: result.threadId } },
  })
  return result
})

/**
 * Run every enabled routine whose schedule had a time after its last run (or, never run, after the first
 * `runDue` that saw it) and at or before `now`. Each runs at most once however many times were missed.
 */
export const runDue = Effect.fn("Routines.runDue")(function* <E, R>(input: { now: Date; run: Run<E, R> }) {
  return yield* CommandVault.withVault((vault) =>
    Effect.gen(function* () {
      const routines = yield* routinesIn(vault)
      const state = yield* readState
      const ran: string[] = []
      for (const routine of routines) {
        const key = stateKey(vault, routine.id)
        const current = state.routines[key] ?? {}
        const since = current.lastRun ?? current.firstSeen
        if (since === undefined) {
          yield* updateState(key, (value) => ({ ...value, firstSeen: input.now.getTime() }))
          continue
        }
        if (!routine.enabled) continue
        const next = safeNextRun(routine.schedule, new Date(since))
        if (!next || next.getTime() > input.now.getTime()) continue
        yield* runOne(vault, routine, input.run, input.now)
        ran.push(routine.id)
      }
      return { ran }
    }),
  )
})

/**
 * Start a routine now. `start` creates the thread and returns its id with the reply still to come; the
 * reply is then filed in the background. Resolves once the thread exists.
 */
export const runNow = Effect.fn("Routines.runNow")(function* <E, R, E2, R2>(input: {
  id: string
  start: (routine: Routine) => Effect.Effect<{ threadId: string; reply: Effect.Effect<string, E2, R2> }, E, R>
}) {
  return yield* CommandVault.withVault((vault) =>
    Effect.gen(function* () {
      const routine = (yield* routinesIn(vault)).find((item) => item.id === input.id)
      if (!routine) return yield* new NotFoundError({ id: input.id })
      const started = yield* input.start(routine)
      yield* runOne(
        vault,
        routine,
        () => started.reply.pipe(Effect.map((text) => ({ threadId: started.threadId, text }))),
        new Date(),
      ).pipe(Effect.forkDetach)
      return { threadId: started.threadId }
    }),
  )
})
