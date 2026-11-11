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

/**
 * Command Centre memory. Command Centre threads run in `<vault root>/.command-centre`, a folder no
 * Project points at, so they never show among Project threads. Old threads are summarised into
 * readable memory files (`.command-centre/memory/<thread>.md`, synced with the vault) and then
 * deleted. Search runs SQLite FTS5 over thread titles, message text and those summaries; the index is
 * a temporary table kept for the process and brought up to date on each search, so nothing but the files
 * and threads needs keeping.
 */

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
// Rows per index insert: four bound values each, well under SQLite's variable limit.
const insertBatch = 200
// Bound IDs per change-stamp lookup or row delete.
const idBatch = 500
const day = 24 * 60 * 60 * 1000
// One search or thread removal at a time: both change the same rows.
const lock = Semaphore.makeUnsafe(1)
// One compaction at a time. It takes `lock` only per removal, so memory search never waits on a model call.
const compaction = Semaphore.makeUnsafe(1)

/** The machine's vault root (`TENON_VAULT_DIR`, else `<home>/Documents/Tenon`). */
export const root = () => KnowledgeVault.rootFor(process.env, Global.make().home)

/**
 * Where Command Centre threads run. Created on first use, with the agent's AGENTS.md, which every
 * thread there loads as its instructions.
 */
export const directory = Effect.fn("CommandMemory.directory")(function* () {
  const folder = path.join(root(), HarnessAppTools.COMMAND_CENTRE_FOLDER)
  yield* Effect.promise(() => mkdir(folder, { recursive: true }))
  yield* Effect.promise(() => writeInstructions(folder))
  return folder
})

// The first line of command-agent.md. A file without it is the user's own and is left alone.
const managed = "<!-- Managed by Tenon Workbench"

/** Writes the Command Centre agent's AGENTS.md, refreshing an older managed copy. */
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

/**
 * Every Command Centre folder this machine has used, the current root's first. A session row keeps the
 * folder it started in, so a thread from before a vault move still runs in its earlier root's folder.
 */
export const folders = (roots = KnowledgeVault.machineRoots(Global.make().data)) =>
  [...new Set([root(), ...Object.keys(roots)])].map((item) => path.join(item, HarnessAppTools.COMMAND_CENTRE_FOLDER))

// Each folder's real path, kept for the process. An earlier root can sit on an offline share, so only async
// fs touches these paths, and a failed lookup isn't kept: the folder may appear or come back later.
const reals = new Map<string, string>()
const resolving = new Map<string, Promise<void>>()

/** Looks up the real path of every Command Centre folder, off the event loop. */
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

// An offline root must not hold up a search or a tool call, so waiting for the lookups is bounded.
const resolved = Effect.promise(() => resolveFolders()).pipe(Effect.timeoutOption("2 seconds"))

const spellings = (folder: string) => [...new Set([folder, path.resolve(folder), reals.get(folder) ?? folder])]

const isCommandFolderName = (value: string) =>
  path.basename(path.resolve(value)) === HarnessAppTools.COMMAND_CENTRE_FOLDER

/**
 * Whether a session directory is a Command Centre folder, of this root or an earlier one. Called on every
 * session update, so any other folder stops at its name, and it never waits on a root: a folder reached through
 * a link only matches once its lookup is done. A miss starts that lookup; `isCommandDirectoryResolved` waits for it.
 */
export function isCommandDirectory(value: string) {
  if (!isCommandFolderName(value)) return false
  const target = fold(value)
  const known = folders()
  if (known.some((folder) => spellings(folder).some((spelling) => fold(spelling) === target))) return true
  void resolveFolders(known)
  return false
}

/** `isCommandDirectory` for callers that can wait for the folders' real paths. */
export const isCommandDirectoryResolved = Effect.fnUntraced(function* (value: string) {
  if (isCommandDirectory(value)) return true
  if (!isCommandFolderName(value)) return false
  yield* resolved
  return isCommandDirectory(value)
})

/** Root Command Centre threads, newest first; archived ones included. */
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

// Each memory file with a stamp that changes when the file is rewritten.
const memoryFiles = Effect.promise(async () => {
  const folder = memoryFolder()
  const names = await readdir(folder).catch(() => [] as string[])
  const files = await Promise.all(
    names
      .filter((name) => name.endsWith(".md"))
      .map(async (name) => {
        const file = path.join(folder, name)
        const info = await stat(file).catch(() => undefined)
        return info?.isFile() ? { file, stamp: `${info.mtimeMs}:${info.size}` } : undefined
      }),
  )
  return files.filter((entry) => entry !== undefined)
})

const readMemory = (file: string) =>
  readFile(file, "utf8").then(
    (source) => ({
      text: source.replace(/^<!-- at: \d+ -->\r?\n/, "").trim(),
      // `<!-- at: <epoch ms> -->` on the first line keeps the original thread's time.
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

/** FTS5 query from free text: each word quoted, all required. */
export function matchQuery(query: string) {
  const words = query.match(/[\p{L}\p{N}_]+/gu) ?? []
  return words
    .slice(0, 16)
    .map((word) => `"${word.replaceAll('"', '""')}"`)
    .join(" ")
}

type Indexed = { rowid: number; stamp: string }

/**
 * What `temp.command_memory_fts` holds: the row and change stamp of each thread (by session ID) and memory
 * file (by path). Searches bring it up to date, so only new or changed threads and files are read again.
 */
const indexed = { threads: new Map<string, Indexed>(), memory: new Map<string, Indexed>(), next: 1 }

const forget = () => {
  indexed.threads.clear()
  indexed.memory.clear()
}

/** Search Command Centre threads and memory summaries. */
export const search = Effect.fn("CommandMemory.search")(function* (query: string) {
  const match = matchQuery(query)
  if (!match) return [] as Hit[]
  return yield* lock
    .withPermits(1)(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        // A temporary table lives only on this connection; the lock keeps searches from sharing it.
        yield* db.run(
          sql.raw(
            "CREATE VIRTUAL TABLE IF NOT EXISTS temp.command_memory_fts USING fts5(session_id UNINDEXED, at UNINDEXED, body)",
          ),
        )
        // A new connection starts with an empty table, so `indexed` no longer describes it.
        const held = yield* db.all<{ rows: number }>(sql`SELECT count(*) AS rows FROM temp.command_memory_fts`)
        if ((held[0]?.rows ?? 0) !== indexed.threads.size + indexed.memory.size) {
          yield* db.run(sql.raw("DELETE FROM temp.command_memory_fts"))
          forget()
        }

        const list = yield* threads()
        const stamp = yield* threadStamps(list.map((session) => session.id))
        const files = yield* memoryFiles
        const staleThreads = stale(indexed.threads, new Map(list.map((session) => [session.id, stamp(session)])))
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

        // Only threads and memory files that are new or changed since they were indexed are read.
        const threadRows = yield* Effect.forEach(
          list.filter((session) => !indexed.threads.has(session.id)),
          (session) =>
            threadText(session.id).pipe(
              Effect.map((text) => ({
                kind: "threads" as const,
                id: session.id as string,
                stamp: stamp(session),
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
                    ? { kind: "memory" as const, id: entry.file, stamp: entry.stamp, sessionID: "", ...memory }
                    : undefined,
                ),
              ),
          ),
        )
        const rows = [...threadRows, ...memoryRows.filter((row) => row !== undefined)].map((row) => ({
          ...row,
          rowid: indexed.next++,
        }))
        // A few multi-row inserts instead of one statement per row.
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

        // Equal ranks keep the order a fresh index gave them: threads newest first, then memory files.
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
      }).pipe(
        // A search that stopped part way may have left rows `indexed` doesn't know; the next one rebuilds.
        Effect.onError(() => Effect.sync(forget)),
      ),
    )
    .pipe(Effect.orDie)
})

// Indexed entries that `current` no longer has, or has with another stamp.
const stale = (held: Map<string, Indexed>, current: Map<string, string>) =>
  [...held].flatMap(([id, item]) => (current.get(id) === item.stamp ? [] : [{ id, rowid: item.rowid }]))

/**
 * Each thread's change stamp. Neither a reply nor a rename moves a session's `time.updated`, so the stamp
 * adds the title and its parts' count and latest write (every part write moves its `time_updated`).
 */
const threadStamps = Effect.fnUntraced(function* (ids: ReadonlyArray<Session.Info["id"]>) {
  const { db } = yield* Database.Service
  const found = new Map<string, string>()
  for (let start = 0; start < ids.length; start += idBatch) {
    const rows = yield* db
      .select({ sessionID: MessageTable.session_id, parts: count(), updated: max(PartTable.time_updated) })
      .from(MessageTable)
      .innerJoin(PartTable, eq(PartTable.message_id, MessageTable.id))
      .where(inArray(MessageTable.session_id, ids.slice(start, start + idBatch)))
      .groupBy(MessageTable.session_id)
      .all()
    for (const row of rows) found.set(row.sessionID, `${row.parts}:${row.updated}`)
  }
  return (session: Session.Info) => JSON.stringify([session.time.updated, session.title, found.get(session.id) ?? ""])
})

/**
 * Summarise Command Centre threads last updated more than `days` ago into memory files, then delete
 * those threads. A thread whose summary fails is kept for the next run, and so is one with no text to
 * summarise (empty, or unreadable right now). Project threads are never read.
 */
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
