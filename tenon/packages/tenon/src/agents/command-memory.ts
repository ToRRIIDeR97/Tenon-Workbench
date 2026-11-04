export * as CommandMemory from "./command-memory"

import { KnowledgeVault } from "@/knowledge/vault"
import { Session } from "@/session/session"
import { Database } from "@tenon/core/database/database"
import { Global } from "@tenon/core/global"
import { sql } from "drizzle-orm"
import { Effect, Schema, Semaphore } from "effect"
import { realpathSync } from "node:fs"
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import COMMAND_AGENT from "./command-agent.md" with { type: "text" }

/**
 * Command Centre memory. Command Centre threads run in `<vault root>/.command-centre`, a folder no
 * Project points at, so they never show among Project threads. Old threads are summarised into
 * readable memory files (`.command-centre/memory/<thread>.md`, synced with the vault) and then
 * deleted. Search runs SQLite FTS5 over thread titles, message text and those summaries; the index is
 * a temporary table rebuilt per search, so nothing but the files and threads needs keeping.
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
  const folder = path.join(root(), ".command-centre")
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

/** Whether a session directory is the Command Centre's. */
export function isCommandDirectory(value: string, base = root()) {
  const target = fold(value)
  return spellings(path.join(base, ".command-centre")).some((spelling) => fold(spelling) === target)
}

const spellings = (folder: string) => {
  const real = (() => {
    try {
      return realpathSync(folder)
    } catch {
      return folder
    }
  })()
  return [...new Set([folder, path.resolve(folder), real])]
}

/** Root Command Centre threads, newest first; archived ones included. */
export const threads = Effect.fn("CommandMemory.threads")(function* () {
  const folder = yield* directory()
  const sessions = yield* Session.Service
  const found = yield* Effect.forEach(spellings(folder), (spelling) =>
    sessions.listGlobal({ directory: spelling, roots: true, archived: true, limit: threadLimit }),
  )
  const seen = new Set<string>()
  return found
    .flat()
    .filter((session) => isCommandDirectory(session.directory) && !seen.has(session.id) && seen.add(session.id))
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

const memoryFolder = () => path.join(root(), ".command-centre", "memory")

type MemoryEntry = { id: string; text: string; at: number }

const readMemory = Effect.promise(async (): Promise<MemoryEntry[]> => {
  const folder = memoryFolder()
  const names = await readdir(folder).catch(() => [] as string[])
  const entries = await Promise.all(
    names
      .filter((name) => name.endsWith(".md"))
      .map(async (name) => {
        const source = await readFile(path.join(folder, name), "utf8").catch(() => undefined)
        if (source === undefined) return undefined
        // `<!-- at: <epoch ms> -->` on the first line keeps the original thread's time.
        const at = Number(/^<!-- at: (\d+) -->/.exec(source)?.[1] ?? 0)
        return { id: name.slice(0, -3), text: source.replace(/^<!-- at: \d+ -->\r?\n/, "").trim(), at }
      }),
  )
  return entries.filter((entry): entry is MemoryEntry => entry !== undefined)
})

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

/** Search Command Centre threads and memory summaries. */
export const search = Effect.fn("CommandMemory.search")(function* (query: string) {
  const match = matchQuery(query)
  if (!match) return [] as Hit[]
  return yield* lock
    .withPermits(1)(
      Effect.gen(function* () {
        const list = yield* threads()
        const rows = [
          ...(yield* Effect.forEach(
            list,
            (session) =>
              threadText(session.id).pipe(
                Effect.map((text) => ({
                  sessionID: session.id as string,
                  text: `${session.title}\n\n${text}`,
                  at: session.time.updated,
                })),
              ),
            { concurrency: 4 },
          )),
          ...(yield* readMemory).map((entry) => ({ sessionID: "", text: entry.text, at: entry.at })),
        ]
        const { db } = yield* Database.Service
        // A temporary table lives only on this connection; the lock keeps searches from sharing it.
        yield* db.run(
          sql.raw(
            "CREATE VIRTUAL TABLE IF NOT EXISTS temp.command_memory_fts USING fts5(session_id UNINDEXED, at UNINDEXED, body)",
          ),
        )
        return yield* Effect.gen(function* () {
          for (const row of rows)
            yield* db.run(
              sql`INSERT INTO temp.command_memory_fts (session_id, at, body) VALUES (${row.sessionID}, ${row.at}, ${row.text})`,
            )
          const found = yield* db.all<{ session_id: string; at: number; body: string }>(
            sql`SELECT session_id, at, body FROM temp.command_memory_fts WHERE command_memory_fts MATCH ${match} ORDER BY rank LIMIT ${hitLimit}`,
          )
          return found.map(
            (row): Hit => ({
              ...(row.session_id ? { sessionID: row.session_id } : {}),
              text: row.body.length > textLimit ? `${row.body.slice(0, textLimit - 1)}…` : row.body,
              at: Number(row.at),
            }),
          )
        }).pipe(Effect.ensuring(db.run(sql.raw("DELETE FROM temp.command_memory_fts")).pipe(Effect.ignore)))
      }),
    )
    .pipe(Effect.orDie)
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
