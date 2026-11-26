import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import timers from "node:timers/promises"
import { SyncError, syncError } from "./error"
import { byName, isPart, requireBytes, requireName, requirePrefix } from "./store"
import type { Store } from "./store"

const GENERATION_BYTES = 32
const INTERNAL = "~tenon"
const LOCK_STALE_MS = 15_000
const LOCK_ATTEMPTS = 2_000

export function folderStore(directory: string): Store {
  const root = path.resolve(directory)
  const fileOf = (name: string) => path.join(root, ...name.split("/"))
  const lockOf = (name: string) => path.join(root, INTERNAL, "locks", createHash("sha256").update(name).digest("hex"))

  const read = (name: string) =>
    fs.readFile(fileOf(name)).then(
      (file) => {
        if (file.length < GENERATION_BYTES) throw syncError("unavailable", "A stored object is damaged")
        return {
          bytes: Uint8Array.from(file.subarray(GENERATION_BYTES)),
          generation: file.subarray(0, GENERATION_BYTES).toString("ascii"),
        }
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "EISDIR" || error.code === "ENOTDIR") return undefined
        throw syncError("unavailable", "The sync folder could not be read")
      },
    )

  const withLock = async <A>(name: string, run: () => Promise<A>) => {
    const lock = lockOf(name)
    await acquire(lock, 0)
    return run().finally(() => fs.rm(lock, { force: true }))
  }

  return {
    async get(name) {
      return read(requireName(name))
    },
    async put(name, bytes, options) {
      requireName(name)
      requireBytes(bytes)
      return withLock(name, async () => {
        const current = await read(name)
        if (options?.ifGeneration === null && current) throw syncError("conflict", "The object already exists")
        if (typeof options?.ifGeneration === "string" && current?.generation !== options.ifGeneration)
          throw syncError("conflict", "The object changed since it was read")
        const generation = Buffer.from(crypto.getRandomValues(new Uint8Array(GENERATION_BYTES / 2))).toString("hex")
        const temporary = path.join(root, INTERNAL, "tmp", crypto.randomUUID())
        const target = fileOf(name)
        await fs.mkdir(path.dirname(temporary), { recursive: true })
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(temporary, Buffer.concat([Buffer.from(generation, "ascii"), bytes]))
        await replace(temporary, target, 0)
        return { generation }
      }).catch(rethrow)
    },
    async list(prefix) {
      requirePrefix(prefix)
      const base = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : ""
      const names = await walk(root, base ? base.split("/") : [])
      const items = await Promise.all(
        names
          .filter((name) => name.startsWith(prefix))
          .map((name) => describe(fileOf(name)).then((found) => (found ? { name, ...found } : undefined))),
      )
      return items.filter((item) => item !== undefined).sort(byName)
    },
    async remove(name) {
      requireName(name)
      await withLock(name, () =>
        fs.unlink(fileOf(name)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" || error.code === "ENOTDIR") return
          throw error
        }),
      ).catch(rethrow)
    },
  }
}

async function describe(file: string) {
  const handle = await fs.open(file, "r").catch(() => undefined)
  if (!handle) return undefined
  const header = Buffer.alloc(GENERATION_BYTES)
  const found = await Promise.all([handle.read(header, 0, GENERATION_BYTES, 0), handle.stat()])
    .then(([read, stat]) =>
      read.bytesRead === GENERATION_BYTES
        ? { generation: header.toString("ascii"), size: stat.size - GENERATION_BYTES }
        : undefined,
    )
    .catch(() => undefined)
    .finally(() => handle.close())
  return found
}

async function walk(root: string, parts: string[]): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, ...parts), { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries
      .filter((entry) => isPart(entry.name))
      .map(async (entry) => {
        if (entry.isDirectory()) return walk(root, [...parts, entry.name])
        if (entry.isFile()) return [[...parts, entry.name].join("/")]
        return []
      }),
  )
  return nested.flat()
}

async function acquire(lock: string, attempt: number): Promise<void> {
  await fs.mkdir(path.dirname(lock), { recursive: true })
  const taken = await fs.open(lock, "wx").then(
    (handle) => handle.close().then(() => true),
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST" || error.code === "EPERM" || error.code === "EACCES") return false
      throw error
    },
  )
  if (taken) return
  const stat = await fs.stat(lock).catch(() => undefined)
  if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) await fs.rm(lock, { force: true })
  if (attempt >= LOCK_ATTEMPTS) throw syncError("unavailable", "The sync folder is busy")
  await timers.setTimeout(2 + Math.random() * 8)
  return acquire(lock, attempt + 1)
}

async function replace(from: string, to: string, attempt: number): Promise<void> {
  const failure = await fs.rename(from, to).then(
    () => undefined,
    (error: NodeJS.ErrnoException) => error,
  )
  if (!failure) return
  if (attempt < 20 && (failure.code === "EPERM" || failure.code === "EBUSY" || failure.code === "EACCES")) {
    await timers.setTimeout(10)
    return replace(from, to, attempt + 1)
  }
  await fs.rm(from, { force: true })
  throw failure
}

function rethrow(error: unknown): never {
  if (error instanceof SyncError) throw error
  throw syncError("unavailable", "The sync folder could not be written")
}
