export * as CommandMemory from "./command-memory"

import { KnowledgeVault } from "@/knowledge/vault"
import { Session } from "@/session/session"
import { Database } from "@tenon/core/database/database"
import { Global } from "@tenon/core/global"
import { HarnessAppTools } from "@tenon/core/harness/app-tools"
import { MessageTable, PartTable } from "@tenon/core/session/sql"
import { count, eq, inArray, max, sql } from "drizzle-orm"
import { Effect, Schema, Semaphore } from "effect"
import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import COMMAND_AGENT from "./command-agent.md" with { type: "text" }

export const Hit = Schema.Struct({
  sessionID: Schema.optional(Schema.String),
  text: Schema.String,
  at: Schema.Number,
})
export type Hit = typeof Hit.Type

export const CompactResult = Schema.Struct({ summarised: Schema.Number, deleted: Schema.Number })
export type CompactResult = typeof CompactResult.Type

export interface Thread {
  readonly sessionID: string
  readonly title: string
  readonly text: string
}

const hitLimit = 20
const textLimit = 600
const threadLimit = 2_000
const insertBatch = 200
const idBatch = 500
const day = 24 * 60 * 60 * 1000
const lock = Semaphore.makeUnsafe(1)
const compaction = Semaphore.makeUnsafe(1)

export const root = () => KnowledgeVault.rootFor(process.env, Global.make().home)

export const directory = Effect.fn("CommandMemory.directory")(function* () {
  const folder = path.join(root(), HarnessAppTools.COMMAND_CENTRE_FOLDER)
  yield* Effect.promise(() => mkdir(folder, { recursive: true }))
  yield* Effect.promise(() => writeInstructions(folder))
  return folder
})

const managed = "<!-- Managed by Tenon Workbench"

export async function writeInstructions(folder: string) {
  const file = path.join(folder, "AGENTS.md")
  const current = await readFile(file, "utf8").catch(() => undefined)
  if (current === COMMAND_AGENT) return
  if (current !== undefined && !current.startsWith(managed)) return
  await writeFile(file, COMMAND_AGENT)
}

const fold = (value: string) => {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export const folders = (roots = KnowledgeVault.machineRoots(Global.make().data)) =>
  [...new Set([root(), ...Object.keys(roots)])].map((item) => path.join(item, HarnessAppTools.COMMAND_CENTRE_FOLDER))

const reals = new Map<string, string>()
const resolving = new Map<string, Promise<void>>()

export const resolveFolders = (list = folders()) =>
  Promise.all(
    list.map((folder) => {
      if (reals.has(folder)) return undefined
      const running =
        resolving.get(folder) ??
        realpath(folder)
          .then(
            (real) => void reals.set(folder, real),
            () => undefined,
          )
          .finally(() => resolving.delete(folder))
      resolving.set(folder, running)
      return running
    }),
  )

const resolved = Effect.promise(() => resolveFolders()).pipe(Effect.timeoutOption("2 seconds"))

const spellings = (folder: string) => [...new Set([folder, path.resolve(folder), reals.get(folder) ?? folder])]

const isCommandFolderName = (value: string) =>
  path.basename(path.resolve(value)) === HarnessAppTools.COMMAND_CENTRE_FOLDER

export function isCommandDirectory(value: string) {
  if (!isCommandFolderName(value)) return false
  const target = fold(value)
  const known = folders()
  if (known.some((folder) => spellings(folder).some((spelling) => fold(spelling) === target))) return true
  void resolveFolders(known)
  return false
}

export const isCommandDirectoryResolved = Effect.fnUntraced(function* (value: string) {
  if (isCommandDirectory(value)) return true
  if (!isCommandFolderName(value)) return false
  yield* resolved
  return isCommandDirectory(value)
})

export const threads = Effect.fn("CommandMemory.threads")(function* () {
  yield* directory()
  yield* resolved
  const sessions = yield* Session.Service
  const known = [...new Set(folders().flatMap(spellings))]
  const found = yield* Effect.forEach(known, (spelling) =>
    sessions.listGlobal({ directory: spelling, roots: true, archived: true, limit: threadLimit }),
  )
  const targets = new Set(known.map(fold))
  const seen = new Set<string>()
  return found
    .flat()
    .filter((session) => targets.has(fold(session.directory)) && !seen.has(session.id) && seen.add(session.id))
    .sort((left, right) => right.time.updated - left.time.updated)
})

const threadText = Effect.fnUntraced(function* (sessionID: Session.Info["id"]) {
  const sessions = yield* Session.Service
  const messages = yield* sessions.messages({ sessionID }).pipe(Effect.orElseSucceed(() => []))
  return messages
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === "text" && !part.synthetic && part.text.trim() ? [part.text] : [])),
    )
    .join("\n\n")
})

const memoryFolder = () => path.join(root(), HarnessAppTools.COMMAND_CENTRE_FOLDER, "memory")

const fileClockSlack = 2_000

const memoryFiles = Effect.promise(async () => {
  const folder = memoryFolder()
  const readAt = Date.now()
  const names = await readdir(folder).catch(() => [] as string[])
  const files = await Promise.all(
    names
      .filter((name) => name.endsWith(".md"))
      .map(async (name) => {
        const file = path.join(folder, name)
        const info = await stat(file).catch(() => undefined)
        if (!info?.isFile()) return undefined
        return { file, stamp: `${info.mtimeMs}:${info.size}`, settled: info.mtimeMs < readAt - fileClockSlack }
      }),
  )
  return files.filter((entry) => entry !== undefined)
})

const readMemory = (file: string) =>
  readFile(file, "utf8").then(
    (source) => ({
      text: source.replace(/^<!-- at: \d+ -->\r?\n/, "").trim(),
      at: Number(/^<!-- at: (\d+) -->/.exec(source)?.[1] ?? 0),
    }),
    () => undefined,
  )

const writeMemory = (id: string, text: string, at: number) =>
  Effect.promise(async () => {
    const folder = memoryFolder()
    await mkdir(folder, { recursive: true })
    const file = path.join(folder, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.md`)
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, `<!-- at: ${at} -->\n${text.trim()}\n`)
    await rename(temp, file)
  })

export function matchQuery(query: string) {
  const words = query.match(/[\p{L}\p{N}_]+/gu) ?? []
  return words
    .slice(0, 16)
    .map((word) => `"${word.replaceAll('"', '""')}"`)
    .join(" ")
}

type Indexed = { rowid: number; stamp: string | undefined }

type Index = { threads: Map<string, Indexed>; memory: Map<string, Indexed>; next: number }

const indexes = new WeakMap<object, Index>()

const indexFor = (db: object) => {
  const found = indexes.get(db)
  if (found) return found
  const created: Index = { threads: new Map(), memory: new Map(), next: 1 }
  indexes.set(db, created)
  return created
}

const forget = (index: Index) => {
  index.threads.clear()
  index.memory.clear()
}

export const search = Effect.fn("CommandMemory.search")(function* (query: string) {
  const match = matchQuery(query)
  if (!match) return [] as Hit[]
  return yield* lock
    .withPermits(1)(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const indexed = indexFor(db)
        return yield* Effect.gen(function* () {
          yield* db.run(
            sql.raw(
              "CREATE VIRTUAL TABLE IF NOT EXISTS temp.command_memory_fts USING fts5(session_id UNINDEXED, at UNINDEXED, body)",
            ),
          )
          const held = yield* db.all<{ rows: number }>(sql`SELECT count(*) AS rows FROM temp.command_memory_fts`)
          if ((held[0]?.rows ?? 0) !== indexed.threads.size + indexed.memory.size) {
            yield* db.run(sql.raw("DELETE FROM temp.command_memory_fts"))
            forget(indexed)
          }

          const list = yield* threads()
          const stamps = yield* threadStamps(list)
          const files = yield* memoryFiles
          const staleThreads = stale(indexed.threads, new Map(list.map((session) => [session.id, stamps.of(session)])))
          const staleMemory = stale(indexed.memory, new Map(files.map((entry) => [entry.file, entry.stamp])))
          const removed = [...staleThreads, ...staleMemory].map((item) => item.rowid)
          for (let start = 0; start < removed.length; start += idBatch)
            yield* db.run(
              sql`DELETE FROM temp.command_memory_fts WHERE rowid IN (${sql.join(
                removed.slice(start, start + idBatch).map((rowid) => sql`${rowid}`),
                sql`, `,
              )})`,
            )
          for (const item of staleThreads) indexed.threads.delete(item.id)
          for (const item of staleMemory) indexed.memory.delete(item.id)

          const threadRows = yield* Effect.forEach(
            list.filter((session) => !indexed.threads.has(session.id)),
            (session) =>
              threadText(session.id).pipe(
                Effect.map((text) => ({
                  kind: "threads" as const,
                  id: session.id as string,
                  stamp: stamps.settled(session) ? stamps.of(session) : undefined,
                  sessionID: session.id as string,
                  text: `${session.title}\n\n${text}`,
                  at: session.time.updated,
                })),
              ),
            { concurrency: 4 },
          )
          const memoryRows = yield* Effect.promise(() =>
            Promise.all(
              files
                .filter((entry) => !indexed.memory.has(entry.file))
                .map((entry) =>
                  readMemory(entry.file).then((memory) =>
                    memory
                      ? {
                          kind: "memory" as const,
                          id: entry.file,
                          stamp: entry.settled ? entry.stamp : undefined,
                          sessionID: "",
                          ...memory,
                        }
                      : undefined,
                  ),
                ),
            ),
          )
          const rows = [...threadRows, ...memoryRows.filter((row) => row !== undefined)].map((row) => ({
            ...row,
            rowid: indexed.next++,
          }))
          for (let start = 0; start < rows.length; start += insertBatch) {
            const batch = rows.slice(start, start + insertBatch)
            yield* db.run(
              sql`INSERT INTO temp.command_memory_fts (rowid, session_id, at, body) VALUES ${sql.join(
                batch.map((row) => sql`(${row.rowid}, ${row.sessionID}, ${row.at}, ${row.text})`),
                sql`, `,
              )}`,
            )
            for (const row of batch) indexed[row.kind].set(row.id, { rowid: row.rowid, stamp: row.stamp })
          }

          const found = yield* db.all<{ session_id: string; at: number; body: string }>(
            sql`SELECT session_id, at, body FROM temp.command_memory_fts WHERE command_memory_fts MATCH ${match} ORDER BY rank, session_id = '', at DESC LIMIT ${hitLimit}`,
          )
          return found.map(
            (row): Hit => ({
              ...(row.session_id ? { sessionID: row.session_id } : {}),
              text: row.body.length > textLimit ? `${row.body.slice(0, textLimit - 1)}…` : row.body,
              at: Number(row.at),
            }),
          )
        }).pipe(Effect.onError(() => Effect.sync(() => forget(indexed))))
      }),
    )
    .pipe(Effect.orDie)
})

const stale = (held: Map<string, Indexed>, current: Map<string, string>) =>
  [...held].flatMap(([id, item]) =>
    item.stamp !== undefined && current.get(id) === item.stamp ? [] : [{ id, rowid: item.rowid }],
  )

const threadStamps = Effect.fnUntraced(function* (list: ReadonlyArray<Session.Info>) {
  const { db } = yield* Database.Service
  const readAt = Date.now()
  const found = new Map<string, { parts: number; updated: number }>()
  for (let start = 0; start < list.length; start += idBatch) {
    const rows = yield* db
      .select({ sessionID: MessageTable.session_id, parts: count(), updated: max(PartTable.time_updated) })
      .from(MessageTable)
      .innerJoin(PartTable, eq(PartTable.message_id, MessageTable.id))
      .where(
        inArray(
          MessageTable.session_id,
          list.slice(start, start + idBatch).map((session) => session.id),
        ),
      )
      .groupBy(MessageTable.session_id)
      .all()
    for (const row of rows) found.set(row.sessionID, { parts: row.parts, updated: row.updated ?? 0 })
  }
  return {
    of: (session: Session.Info) =>
      JSON.stringify([
        session.time.updated,
        session.title,
        found.get(session.id)?.parts ?? 0,
        found.get(session.id)?.updated ?? 0,
      ]),
    settled: (session: Session.Info) => Math.max(session.time.updated, found.get(session.id)?.updated ?? 0) < readAt,
  }
})

export const compact = Effect.fn("CommandMemory.compact")(function* <E, R>(input: {
  now?: number
  days: number
  summarize: (thread: Thread) => Effect.Effect<string, E, R>
}) {
  const now = input.now ?? Date.now()
  const days = Math.min(365, Math.max(1, Math.floor(input.days)))
  const cutoff = now - days * day
  return yield* compaction.withPermits(1)(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const old = (yield* threads()).filter((session) => session.time.updated < cutoff)
      let summarised = 0
      let deleted = 0
      for (const session of old) {
        const text = yield* threadText(session.id)
        if (!text.trim()) continue
        const summary = yield* input
          .summarize({ sessionID: session.id, title: session.title, text })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Command Centre summary failed; thread kept", { sessionID: session.id, cause }).pipe(
                Effect.as(undefined),
              ),
            ),
          )
        if (summary === undefined || !summary.trim()) continue
        yield* writeMemory(session.id, summary, session.time.updated)
        summarised++
        const removed = yield* lock
          .withPermits(1)(sessions.remove(session.id))
          .pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
          )
        if (removed) deleted++
      }
      return { summarised, deleted }
    }),
  )
})
