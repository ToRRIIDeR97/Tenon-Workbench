export * as ThreadSearch from "./thread-search"

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "./database/database"
import { PartTable, SessionMessageTable, SessionTable } from "./session/sql"

export type Hit = { id: string; title: string; directory: string; snippet: string; updated: number }

export type Row = { store: "v2"; type: string; data: unknown } | { store: "v1"; data: unknown }

const ROW_LIMIT = 400
const MIN_QUERY = 2

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

export function validQuery(query: string) {
  return query.trim().length >= MIN_QUERY
}

export function rowText(row: Row) {
  const data = record(row.data)
  if (!data) return ""
  if (row.store === "v1") {
    if (data.type !== "text" || data.synthetic === true || data.ignored === true) return ""
    return typeof data.text === "string" ? data.text : ""
  }
  if (row.type === "user") return typeof data.text === "string" ? data.text : ""
  if (row.type !== "assistant" || !Array.isArray(data.content)) return ""
  return data.content
    .flatMap((item) => {
      const part = record(item)
      return part?.type === "text" && typeof part.text === "string" ? [part.text] : []
    })
    .join("\n")
}

export function snippet(text: string, index: number, length: number, radius = 60) {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + length + radius)
  const middle = text.slice(start, end).replace(/\s+/g, " ").trim()
  return `${start > 0 ? "…" : ""}${middle}${end < text.length ? "…" : ""}`
}

const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

export const search = Effect.fn("ThreadSearch.search")(function* (query: string, limit: number) {
  if (!validQuery(query)) return [] as Hit[]
  const needle = query.trim()
  const lower = needle.toLowerCase()
  const pattern = likePattern(needle)
  const db = (yield* Database.Service).db
  const live = isNull(SessionTable.time_archived)
  const sessionFields = {
    id: SessionTable.id,
    title: SessionTable.title,
    directory: SessionTable.directory,
    updated: SessionTable.time_updated,
  }
  const titled = yield* db
    .select(sessionFields)
    .from(SessionTable)
    .where(and(live, sql`${SessionTable.title} LIKE ${pattern} ESCAPE '\\'`))
    .orderBy(desc(SessionTable.time_updated))
    .limit(ROW_LIMIT)
    .all()
  const v2 = yield* db
    .select({ ...sessionFields, type: SessionMessageTable.type, data: SessionMessageTable.data })
    .from(SessionMessageTable)
    .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.session_id))
    .where(
      and(
        live,
        inArray(SessionMessageTable.type, ["user", "assistant"] as never[]),
        sql`${SessionMessageTable.data} LIKE ${pattern} ESCAPE '\\'`,
      ),
    )
    .orderBy(desc(SessionMessageTable.time_created))
    .limit(ROW_LIMIT)
    .all()
  const v1 = yield* db
    .select({ ...sessionFields, data: PartTable.data })
    .from(PartTable)
    .innerJoin(SessionTable, eq(SessionTable.id, PartTable.session_id))
    .where(and(live, sql`${PartTable.data} LIKE ${pattern} ESCAPE '\\'`))
    .orderBy(desc(PartTable.time_created))
    .limit(ROW_LIMIT)
    .all()
  const hits = new Map<string, Hit>()
  const take = (row: { id: string; title: string; directory: string; updated: number }, text: string) => {
    if (hits.has(row.id)) return
    const index = text.toLowerCase().indexOf(lower)
    if (index < 0) return
    hits.set(row.id, {
      id: row.id,
      title: row.title,
      directory: row.directory,
      snippet: snippet(text, index, needle.length),
      updated: row.updated,
    })
  }
  for (const row of v2) take(row, rowText({ store: "v2", type: row.type, data: row.data }))
  for (const row of v1) take(row, rowText({ store: "v1", data: row.data }))
  for (const row of titled) take(row, row.title)
  return [...hits.values()].sort((left, right) => right.updated - left.updated).slice(0, Math.max(0, limit))
})
