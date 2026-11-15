import { createHash } from "node:crypto"
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"

export const MAX_FILE_BYTES = 1024 * 1024
/** The sync file also carries skills, so it may be larger than one tool file. */
export const MAX_SYNC_FILE_BYTES = 8 * 1024 * 1024

export const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")

const missing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"

/** Reads a regular UTF-8 file under `limit` bytes; undefined when it does not exist. Throws a reason to show. */
export async function readText(file: string, limit = MAX_FILE_BYTES) {
  const info = await lstat(file).catch((error) => {
    if (missing(error)) return undefined
    throw error
  })
  if (!info) return undefined
  if (info.isSymbolicLink()) throw new Error("is a symbolic link, so Tenon leaves it alone")
  if (!info.isFile()) throw new Error("is not a regular file")
  if (info.size > limit) throw new Error(`is larger than ${limit / (1024 * 1024)} MB`)
  // A file that is not UTF-8 would be rewritten with replacement characters, so it is refused instead.
  const text = utf8(await readFile(file))
  if (text === undefined) throw new Error("is not UTF-8 text")
  return text
}

function utf8(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** Like `readText`, but a reason to show instead of an exception, as `{ error }`. */
export const tryReadText = (file: string, limit = MAX_FILE_BYTES) =>
  readText(file, limit).then(
    (text) => ({ text }),
    (error: unknown) => ({ error: message(error) }),
  )

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Writes through a flushed temporary sibling, then renames it over the target. */
export async function writeAtomic(file: string, content: string) {
  const dir = path.dirname(file)
  await mkdir(dir, { recursive: true })
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
  const handle = await open(temp, "w")
  const written = await handle
    .writeFile(content)
    .then(() => handle.sync())
    .finally(() => handle.close())
    .then(() => rename(temp, file))
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  if (written === undefined) return
  await rm(temp, { force: true })
  throw written
}

/** RFC 3339 in UTC to the second, as the sync file has always stored it. */
export const nowRfc3339 = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
