export * as GithubThreads from "./threads"

import { and, asc, eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../database/database"
import { PartTable, SessionMessageTable, SessionTable } from "../session/sql"

// Which thread produced a PR (#331): the first thread in the Project's folder whose messages carry the PR's URL.
// `gh pr create` prints it, and agents cite it, so a harness thread and a built-in one both leave it in their
// stored messages (v2 `session_message` and v1 `part`). Read-only; nothing is recorded at tool time.

export type Mention = { sessionID: string; title: string; time: number; text: string }
export type Thread = { id: string; title: string }

/** How many message rows one lookup reads at most, oldest first, per store. */
const ROW_LIMIT = 2_000

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** PR number → the earliest thread mentioning `https://github.com/<repo>/pull/<n>` (owner/name ignore case). */
export function pullThreads(mentions: ReadonlyArray<Mention>, repo: string) {
  const pattern = new RegExp(`https?://(?:www\\.)?github\\.com/${escape(repo)}/pull/(\\d+)(?!\\d)`, "gi")
  const threads = new Map<number, Thread>()
  for (const mention of mentions.toSorted((a, b) => a.time - b.time)) {
    for (const match of mention.text.matchAll(pattern)) {
      const number = Number(match[1])
      if (!threads.has(number)) threads.set(number, { id: mention.sessionID, title: mention.title })
    }
  }
  return threads
}

/** The PRs with the thread that produced each, where one is known. */
export function attach<P extends { number: number }>(
  pulls: ReadonlyArray<P>,
  threads: ReadonlyMap<number, Thread>,
): Array<P & { thread?: Thread }> {
  return pulls.map((pull) => {
    const thread = threads.get(pull.number)
    return thread ? { ...pull, thread } : pull
  })
}

/** Messages of the folder's threads that mention one of `repo`'s PRs, from both message stores. */
export const mentions = Effect.fn("GithubThreads.mentions")(function* (directory: string, repo: string) {
  const db = (yield* Database.Service).db
  // LIKE is a cheap pre-filter (case-insensitive for ASCII); `pullThreads` matches the URL exactly.
  const needle = `%github.com/${repo}/pull/%`
  const v2 = yield* db
    .select({
      sessionID: SessionTable.id,
      title: SessionTable.title,
      time: SessionMessageTable.time_created,
      data: SessionMessageTable.data,
    })
    .from(SessionMessageTable)
    .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.session_id))
    .where(and(eq(SessionTable.directory, directory), sql`${SessionMessageTable.data} LIKE ${needle}`))
    .orderBy(asc(SessionMessageTable.time_created))
    .limit(ROW_LIMIT)
    .all()
  const v1 = yield* db
    .select({
      sessionID: SessionTable.id,
      title: SessionTable.title,
      time: PartTable.time_created,
      data: PartTable.data,
    })
    .from(PartTable)
    .innerJoin(SessionTable, eq(SessionTable.id, PartTable.session_id))
    .where(and(eq(SessionTable.directory, directory), sql`${PartTable.data} LIKE ${needle}`))
    .orderBy(asc(PartTable.time_created))
    .limit(ROW_LIMIT)
    .all()
  return [...v2, ...v1].map(
    (row): Mention => ({
      sessionID: row.sessionID,
      title: row.title,
      time: row.time,
      text: typeof row.data === "string" ? row.data : JSON.stringify(row.data),
    }),
  )
})
