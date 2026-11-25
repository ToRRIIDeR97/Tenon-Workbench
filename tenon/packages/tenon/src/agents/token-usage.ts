export * as TokenUsage from "./token-usage"

import { Database } from "@tenon/core/database/database"
import { Global } from "@tenon/core/global"
import { HarnessSubagentTrace } from "@tenon/core/harness/subagent-trace"
import { MessageTable, SessionMessageTable, SessionTable } from "@tenon/core/session/sql"
import { and, eq, gte, sql } from "drizzle-orm"
import { Cause, Effect, Schema } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export const BUILT_IN = "opencode"
export const THREAD_LIMIT = 12
export const SUBAGENT_LIMIT = 12
export const TRACE_TIMEOUT = "20 seconds"
export const TRACE_RETRY_MS = 10 * 60 * 1000

export const Tokens = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
})
export type Tokens = typeof Tokens.Type

export const Day = Schema.Struct({ day: Schema.String, fresh: Schema.Number, cached: Schema.Number })

export const HarnessTotal = Schema.Struct({
  harness: Schema.String,
  models: Schema.Array(Schema.String),
  total: Schema.Number,
  subagents: Schema.Number,
  unreported: Schema.Number,
  cost: Schema.Number,
})

export const Subagent = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  total: Schema.optional(Schema.Number),
  source: Schema.Literals(["harness", "opencode-session", "claude-transcript", "thread"]),
  sessionID: Schema.optional(Schema.String),
})
export type Subagent = typeof Subagent.Type

export const Thread = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  harness: Schema.String,
  model: Schema.optional(Schema.String),
  total: Schema.Number,
  main: Schema.Number,
  cost: Schema.Number,
  at: Schema.Number,
  subagents: Schema.Array(Subagent),
  subagentCount: Schema.Number,
  unreported: Schema.Number,
})
export type Thread = typeof Thread.Type

export const Summary = Schema.Struct({
  since: Schema.Number,
  totals: Tokens,
  cost: Schema.Number,
  threads: Schema.Number,
  days: Schema.Array(Day),
  harnesses: Schema.Array(HarnessTotal),
  heaviest: Schema.Array(Thread),
})
export type Summary = typeof Summary.Type

export type TracedSource = "opencode-session" | "claude-transcript"

export type SubagentCall = {
  name?: string
  description?: string
  usage?: Tokens
  source?: TracedSource
  output?: string
}

export type Trace = (refs: ReadonlyArray<HarnessSubagentTrace.Ref>) => Effect.Effect<ReadonlyMap<string, unknown>>

export type Row = {
  session: string
  at: number
  harness: string
  model?: string
  tokens?: Tokens
  cost: number
  subagents: ReadonlyArray<SubagentCall>
}

export type SessionRow = { id: string; title: string; directory: string; parent?: string }

type MutableTokens = { -readonly [K in keyof Tokens]: Tokens[K] }

export const empty = (): MutableTokens => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })

export const sum = (tokens: Tokens) =>
  tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite

const add = (into: MutableTokens, from: Tokens) => {
  into.input += from.input
  into.output += from.output
  into.reasoning += from.reasoning
  into.cacheRead += from.cacheRead
  into.cacheWrite += from.cacheWrite
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0)

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const parse = (value: unknown): unknown => {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function messageTokens(value: unknown): Tokens | undefined {
  const tokens = parse(value)
  if (!record(tokens)) return undefined
  const cache = record(tokens.cache) ? tokens.cache : {}
  return {
    input: count(tokens.input),
    output: count(tokens.output),
    reasoning: count(tokens.reasoning),
    cacheRead: count(cache.read),
    cacheWrite: count(cache.write),
  }
}

export function subagentTokens(value: unknown): Tokens | undefined {
  const usage = parse(value)
  if (!record(usage)) return undefined
  const tokens = {
    input: count(usage.inputTokens),
    output: count(usage.outputTokens),
    reasoning: count(usage.thoughtTokens),
    cacheRead: count(usage.cachedReadTokens),
    cacheWrite: count(usage.cachedWriteTokens),
  }
  return sum(tokens) > 0 ? tokens : undefined
}

export function subagentCalls(value: unknown): SubagentCall[] {
  const list = parse(value)
  if (!Array.isArray(list)) return []
  return list.filter(record).map((call) => ({
    ...(typeof call.name === "string" && call.name ? { name: call.name } : {}),
    ...(typeof call.description === "string" && call.description ? { description: call.description } : {}),
    ...(subagentTokens(call.usage) ? { usage: subagentTokens(call.usage) } : {}),
    ...(typeof call.output === "string" && call.output && !subagentTokens(call.usage) ? { output: call.output } : {}),
  }))
}

export function dayOf(at: number, offsetMinutes: number) {
  return new Date(at - offsetMinutes * 60_000).toISOString().slice(0, 10)
}

type ThreadAcc = {
  id: string
  main: number
  cost: number
  at: number
  harness: Map<string, number>
  model: Map<string, number>
  subagents: Subagent[]
  unreported: number
}

const heaviest = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]

export function summarize(input: {
  rows: ReadonlyArray<Row>
  sessions: ReadonlyArray<SessionRow>
  since: number
  offsetMinutes: number
  limit?: number
}): Summary {
  const sessions = new Map(input.sessions.map((session) => [session.id, session]))
  const rootOf = (id: string) => {
    const seen = new Set<string>()
    let current = id
    while (!seen.has(current)) {
      seen.add(current)
      const parent = sessions.get(current)?.parent
      if (!parent || !sessions.has(parent)) return current
      current = parent
    }
    return current
  }

  const totals = empty()
  let cost = 0
  const days = new Map<string, { fresh: number; cached: number }>()
  const harnesses = new Map<
    string,
    { models: Set<string>; total: number; subagents: number; unreported: number; cost: number }
  >()
  const threads = new Map<string, ThreadAcc>()
  const childTotals = new Map<string, { root: string; total: number }>()

  const addDay = (at: number, tokens: Tokens) => {
    const key = dayOf(at, input.offsetMinutes)
    const day = days.get(key) ?? { fresh: 0, cached: 0 }
    day.cached += tokens.cacheRead
    day.fresh += sum(tokens) - tokens.cacheRead
    days.set(key, day)
  }

  for (const row of input.rows) {
    const root = rootOf(row.session)
    const child = root !== row.session
    const harness =
      harnesses.get(row.harness) ??
      harnesses
        .set(row.harness, { models: new Set(), total: 0, subagents: 0, unreported: 0, cost: 0 })
        .get(row.harness)!
    if (row.model) harness.models.add(row.model)
    const thread =
      threads.get(root) ??
      threads
        .set(root, {
          id: root,
          main: 0,
          cost: 0,
          at: 0,
          harness: new Map(),
          model: new Map(),
          subagents: [],
          unreported: 0,
        })
        .get(root)!
    thread.at = Math.max(thread.at, row.at)
    thread.cost += row.cost
    harness.cost += row.cost
    cost += row.cost

    if (row.tokens) {
      const amount = sum(row.tokens)
      add(totals, row.tokens)
      addDay(row.at, row.tokens)
      harness.total += amount
      if (child) {
        harness.subagents += amount
        const held = childTotals.get(row.session) ?? { root, total: 0 }
        held.total += amount
        childTotals.set(row.session, held)
      } else {
        thread.main += amount
        thread.harness.set(row.harness, (thread.harness.get(row.harness) ?? 0) + amount)
        if (row.model) thread.model.set(row.model, (thread.model.get(row.model) ?? 0) + amount)
      }
    }

    for (const call of row.subagents) {
      if (!call.usage) {
        harness.unreported += 1
        thread.unreported += 1
        continue
      }
      const amount = sum(call.usage)
      add(totals, call.usage)
      addDay(row.at, call.usage)
      harness.total += amount
      harness.subagents += amount
      thread.subagents.push({
        name: call.name ?? "subagent",
        ...(call.description ? { description: call.description } : {}),
        total: amount,
        source: call.source ?? "harness",
      })
    }
  }

  for (const [id, held] of childTotals) {
    const thread = threads.get(held.root)
    if (!thread) continue
    thread.subagents.push({
      name: sessions.get(id)?.title || "Thread",
      total: held.total,
      source: "thread",
      sessionID: id,
    })
  }

  const heaviestThreads = [...threads.values()]
    .map((thread): Thread => {
      const subagents = [...thread.subagents].sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
      const subTotal = subagents.reduce((total, item) => total + (item.total ?? 0), 0)
      const info = sessions.get(thread.id)
      const model = heaviest(thread.model)
      return {
        id: thread.id,
        title: info?.title ?? "",
        directory: info?.directory ?? "",
        harness: heaviest(thread.harness) ?? BUILT_IN,
        ...(model ? { model } : {}),
        total: thread.main + subTotal,
        main: thread.main,
        cost: thread.cost,
        at: thread.at,
        subagents: subagents.slice(0, SUBAGENT_LIMIT),
        subagentCount: subagents.length,
        unreported: thread.unreported,
      }
    })
    .filter((thread) => thread.total > 0)
    .sort((a, b) => b.total - a.total)

  return {
    since: input.since,
    totals,
    cost,
    threads: heaviestThreads.length,
    days: [...days].map(([day, value]) => ({ day, ...value })).sort((a, b) => a.day.localeCompare(b.day)),
    harnesses: [...harnesses]
      .map(([id, value]) => ({
        harness: id,
        models: [...value.models].sort(),
        total: value.total,
        subagents: value.subagents,
        unreported: value.unreported,
        cost: value.cost,
      }))
      .filter((item) => item.total > 0 || item.unreported > 0)
      .sort((a, b) => b.total - a.total),
    heaviest: heaviestThreads.slice(0, input.limit ?? THREAD_LIMIT),
  }
}

const subagentColumn = sql<string | null>`(
  select json_group_array(json_object(
    'name', coalesce(json_extract(value, '$.state.input.agent'), json_extract(value, '$.state.input.subagent_type')),
    'description', json_extract(value, '$.state.input.description'),
    'usage', coalesce(
      json_extract(value, '$.provider.resultMetadata.acp.usage'),
      json_extract(value, '$.state.structured.acp.usage')
    ),
    'output', case
      when json_extract(value, '$.provider.resultMetadata.acp.usage') is null
        and json_extract(value, '$.state.structured.acp.usage') is null
      then substr(coalesce(json_extract(value, '$.state.result.value'), json_extract(value, '$.state.content[0].text'), ''), 1, 600)
        || ' ' || substr(coalesce(json_extract(value, '$.state.result.value'), json_extract(value, '$.state.content[0].text'), ''), -600)
    end
  ))
  from json_each(${SessionMessageTable.data}, '$.content')
  where json_extract(value, '$.type') = 'tool' and json_extract(value, '$.name') = 'acp_subagent'
)`

export const read = Effect.fn("TokenUsage.read")(function* (input: {
  since: number
  offsetMinutes: number
  trace?: Trace
  cacheFile?: string
}) {
  const { db } = yield* Database.Service
  const current = yield* db
    .select({
      session: SessionMessageTable.session_id,
      at: SessionMessageTable.time_created,
      harness: sql<string | null>`json_extract(${SessionMessageTable.data}, '$.harnessInstanceID')`,
      model: sql<string | null>`json_extract(${SessionMessageTable.data}, '$.model.id')`,
      tokens: sql<string | null>`json_extract(${SessionMessageTable.data}, '$.tokens')`,
      cost: sql<number | null>`json_extract(${SessionMessageTable.data}, '$.cost')`,
      subagents: subagentColumn,
    })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.type, "assistant"), gte(SessionMessageTable.time_created, input.since)))
    .all()
  const legacy = yield* db
    .select({
      session: MessageTable.session_id,
      at: MessageTable.time_created,
      model: sql<string | null>`json_extract(${MessageTable.data}, '$.modelID')`,
      tokens: sql<string | null>`json_extract(${MessageTable.data}, '$.tokens')`,
      cost: sql<number | null>`json_extract(${MessageTable.data}, '$.cost')`,
    })
    .from(MessageTable)
    .where(
      and(sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`, gte(MessageTable.time_created, input.since)),
    )
    .all()
  const sessions = yield* db
    .select({
      id: SessionTable.id,
      title: SessionTable.title,
      directory: SessionTable.directory,
      parent: SessionTable.parent_id,
    })
    .from(SessionTable)
    .all()
  const rows: Row[] = [
    ...current.map((row) => ({
      session: row.session,
      at: row.at,
      harness: row.harness || BUILT_IN,
      ...(row.model ? { model: row.model } : {}),
      ...(messageTokens(row.tokens) ? { tokens: messageTokens(row.tokens) } : {}),
      cost: count(row.cost),
      subagents: subagentCalls(row.subagents),
    })),
    ...legacy.map((row) => ({
      session: row.session,
      at: row.at,
      harness: BUILT_IN,
      ...(row.model ? { model: row.model } : {}),
      ...(messageTokens(row.tokens) ? { tokens: messageTokens(row.tokens) } : {}),
      cost: count(row.cost),
      subagents: [],
    })),
  ]
  const directories = new Map(sessions.map((session) => [session.id, session.directory]))
  const traced = input.trace
    ? yield* traceUnreported({
        rows,
        directories,
        trace: input.trace,
        cacheFile: input.cacheFile ?? path.join(Global.make().data, CACHE_FILE),
      })
    : rows
  return summarize({
    rows: traced,
    sessions: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      directory: session.directory,
      ...(session.parent ? { parent: session.parent } : {}),
    })),
    since: input.since,
    offsetMinutes: input.offsetMinutes,
  })
})

export const CACHE_FILE = "subagent-usage.json"

const misses = new Map<string, number>()

const tracedSource = (kind: HarnessSubagentTrace.Kind): TracedSource =>
  kind === "opencode-session" ? "opencode-session" : "claude-transcript"

export const traceUnreported = Effect.fnUntraced(function* (input: {
  rows: ReadonlyArray<Row>
  directories: ReadonlyMap<string, string>
  trace: Trace
  cacheFile: string
  claudeConfigDir?: string
  now?: number
}) {
  const now = input.now ?? Date.now()
  const refFor = (row: Row, call: SubagentCall) =>
    call.usage || !call.output
      ? undefined
      : HarnessSubagentTrace.ref(row.harness, call.output, input.directories.get(row.session) ?? "")
  const refs = new Map(
    input.rows.flatMap((row) =>
      row.subagents.flatMap((call) => {
        const found = refFor(row, call)
        return found ? [[HarnessSubagentTrace.key(found), found] as const] : []
      }),
    ),
  )
  if (refs.size === 0) return input.rows
  const cached = yield* Effect.promise(() => readCache(input.cacheFile))
  const missing = [...refs].filter(
    ([key, item]) => !cached[key] && item.directory && now - (misses.get(key) ?? -Infinity) > TRACE_RETRY_MS,
  )
  const groups = [
    { kind: "claude-agent" as const, read: claudeTrace(input.claudeConfigDir) },
    { kind: "opencode-session" as const, read: input.trace },
  ]
  const results = yield* Effect.forEach(
    groups,
    (group) => {
      const items = missing.filter(([, item]) => item.kind === group.kind).map(([, item]) => item)
      if (items.length === 0) return Effect.succeed({ items, found: new Map<string, unknown>() })
      return group.read(items).pipe(
        Effect.map((found): ReadonlyMap<string, unknown> | undefined => found),
        Effect.timeoutOrElse({
          duration: TRACE_TIMEOUT,
          orElse: () =>
            Effect.logWarning("Subagent usage trace timed out", { kind: group.kind, count: items.length }).pipe(
              Effect.as(undefined),
            ),
        }),
        Effect.catchCause((cause) =>
          Effect.logWarning("Subagent usage trace failed", {
            kind: group.kind,
            cause: Cause.pretty(cause).split("\n")[0],
          }).pipe(Effect.as(undefined)),
        ),
        Effect.map((found) => ({ items, found })),
      )
    },
    { concurrency: "unbounded" },
  )
  const fresh = Object.fromEntries(
    results.flatMap((result) =>
      result.items.flatMap((item) => {
        const key = HarnessSubagentTrace.key(item)
        const tokens = subagentTokens(result.found?.get(key))
        if (tokens) return [[key, tokens] as const]
        if (result.found) misses.set(key, now)
        return []
      }),
    ),
  )
  if (Object.keys(fresh).length > 0) yield* Effect.promise(() => writeCache(input.cacheFile, { ...cached, ...fresh }))
  const known: Record<string, Tokens> = { ...cached, ...fresh }
  return input.rows.map((row) => ({
    ...row,
    subagents: row.subagents.map((call) => {
      const item = refFor(row, call)
      const tokens = item ? known[HarnessSubagentTrace.key(item)] : undefined
      if (!item || !tokens) return call
      return { ...call, usage: tokens, source: tracedSource(item.kind) }
    }),
  }))
})

const claudeTrace =
  (configDir = HarnessSubagentTrace.claudeConfigDir(process.env)): Trace =>
  (refs) =>
    Effect.forEach(
      refs,
      (item) =>
        HarnessSubagentTrace.claudeAgentUsage({ configDir, directory: item.directory, agentId: item.id }).pipe(
          Effect.map((usage) => [HarnessSubagentTrace.key(item), usage] as const),
        ),
      { concurrency: 6 },
    ).pipe(Effect.map((found) => new Map(found)))

async function readCache(file: string): Promise<Record<string, Tokens>> {
  const parsed = parse(await readFile(file, "utf8").catch(() => ""))
  if (!record(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) => {
      const tokens = record(value) ? toTokens(value) : undefined
      return tokens ? [[key, tokens] as const] : []
    }),
  )
}

function toTokens(value: Record<string, unknown>): Tokens | undefined {
  const tokens = {
    input: count(value.input),
    output: count(value.output),
    reasoning: count(value.reasoning),
    cacheRead: count(value.cacheRead),
    cacheWrite: count(value.cacheWrite),
  }
  return sum(tokens) > 0 ? tokens : undefined
}

async function writeCache(file: string, value: Record<string, Tokens>) {
  await mkdir(path.dirname(file), { recursive: true }).catch(() => undefined)
  await writeFile(file, JSON.stringify(value), "utf8").catch(() => undefined)
}
