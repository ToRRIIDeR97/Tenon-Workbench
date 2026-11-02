import { chmodSync, existsSync, renameSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import { blob, sqliteTable, text } from "drizzle-orm/sqlite-core"

const documents = sqliteTable("document", {
  key: text().primaryKey(),
  value: text().notNull(),
})
const blobs = sqliteTable("blob", {
  id: text().primaryKey(),
  data: blob({ mode: "buffer" }).notNull(),
})

// One pasted or dropped attachment. IPC has already copied a larger blob into
// main-process memory, but it is refused before it is hashed or written to
// SQLite; the renderer then keeps that attachment in memory only.
export const MAX_DRAFT_BLOB_BYTES = 64 * 1024 * 1024

export function requireDraftKey(value: unknown) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error("Invalid draft key")
}

export function requireDraftValue(value: unknown) {
  if (typeof value === "string") return value
  throw new Error("Invalid draft value")
}

export function requireDraftBlob(value: unknown) {
  if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) throw new Error("Invalid draft blob")
  if (value.byteLength > MAX_DRAFT_BLOB_BYTES) throw new Error("Draft blob too large")
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  // IPC never delivers shared memory, and WebCrypto hashing needs a plain ArrayBuffer.
  if (!(value.buffer instanceof ArrayBuffer)) throw new Error("Invalid draft blob")
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

// Drafts stay unencrypted, like the session database beside them, so the files
// are at least kept from other local users. Windows ACLs already scope userData.
export function ownerOnly(filename: string) {
  if (process.platform === "win32" || filename === ":memory:") return
  for (const file of [filename, `${filename}-wal`, `${filename}-shm`]) {
    if (existsSync(file)) chmodSync(file, 0o600)
  }
}

/**
 * Opens the draft store. A damaged database file (a crash or a killed process mid-write) is moved aside, so the app
 * still starts with an empty store instead of failing at launch; `onRecovered` hears where the old file went.
 */
export function createDesktopDraftStore(
  filename: string,
  onFlushError?: (error: unknown) => void,
  onRecovered?: (aside: string) => void,
) {
  try {
    return openDraftStore(filename, onFlushError)
  } catch (error) {
    if (filename === ":memory:" || !isCorrupt(error)) throw error
    const aside = `${filename}.damaged-${Date.now()}`
    for (const suffix of ["", "-wal", "-shm"])
      if (existsSync(`${filename}${suffix}`)) renameSync(`${filename}${suffix}`, `${aside}${suffix}`)
    onRecovered?.(aside)
    return openDraftStore(filename, onFlushError)
  }
}

function isCorrupt(error: unknown) {
  return error instanceof Error && /malformed|not a database|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(error.message)
}

function openDraftStore(filename: string, onFlushError?: (error: unknown) => void) {
  const native = new DatabaseSync(filename)
  const db = drizzle({ client: native })
  const used = new Set<string>()
  try {
    native.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS document (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blob (id TEXT PRIMARY KEY, data BLOB NOT NULL);",
    )
    ownerOnly(filename)
    db.select({ value: documents.value })
      .from(documents)
      .all()
      .forEach(({ value }) =>
        JSON.parse(value, (_key, item) => {
          if (item?.blob && typeof item.blob.id === "string") used.add(item.blob.id)
          return item
        }),
      )
    // One statement for all orphans; json_each sidesteps SQLite's bound-parameter limit.
    db.transaction((tx) =>
      tx
        .delete(blobs)
        .where(sql`${blobs.id} NOT IN (SELECT value FROM json_each(${JSON.stringify([...used])}))`)
        .run(),
    )
  } catch (error) {
    // Closed so a damaged file can be moved aside (Windows won't rename an open file).
    native.close()
    throw error
  }
  const pending = new Map<string, string | null>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const writes = [...pending]
    pending.clear()
    try {
      db.transaction((tx) => {
        writes.forEach(([key, value]) => {
          if (value === null) tx.delete(documents).where(eq(documents.key, key)).run()
          else
            tx.insert(documents)
              .values({ key, value })
              .onConflictDoUpdate({ target: documents.key, set: { value } })
              .run()
        })
      })
    } catch (error) {
      // A timer flush runs outside any caller, so a throw here would be
      // uncaught. Keep the failed batch, unless a newer write replaced a key,
      // and retry it with the next write or the quit flush.
      writes.forEach(([key, value]) => {
        if (!pending.has(key)) pending.set(key, value)
      })
      onFlushError?.(error)
    }
  }
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 500)
  }
  return {
    get: (key: string) =>
      pending.has(key)
        ? (pending.get(key) ?? null)
        : (db.select({ value: documents.value }).from(documents).where(eq(documents.key, key)).get()?.value ?? null),
    set(key: string, value: string | null) {
      pending.set(key, value)
      schedule()
    },
    // Hashing a large paste runs on libuv's thread pool, and a blob that is already
    // stored is not written again, so only the insert of new bytes holds the main thread.
    async putBlob(data: Uint8Array<ArrayBuffer>) {
      const id = Buffer.from(await crypto.subtle.digest("SHA-256", data)).toString("hex")
      if (db.select({ id: blobs.id }).from(blobs).where(eq(blobs.id, id)).get()) return id
      db.insert(blobs)
        .values({ id, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) })
        .onConflictDoNothing()
        .run()
      return id
    },
    getBlob: (id: string) => db.select({ data: blobs.data }).from(blobs).where(eq(blobs.id, id)).get()?.data ?? null,
    flush,
    close() {
      flush()
      native.close()
    },
  }
}
