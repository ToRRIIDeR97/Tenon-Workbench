import { createHash, randomBytes } from "node:crypto"
import timers from "node:timers/promises"
import { Option, Schema } from "effect"
import { SyncError, syncError } from "./error"
import { byName, isName, isPart, requireBytes, requireName, requirePrefix } from "./store"
import type { Store } from "./store"

export const DRIVE_FOLDER = "Tenon Workbench Threads"

const DEFAULT_ENDPOINT = "https://www.googleapis.com"
const FOLDER_TYPE = "application/vnd.google-apps.folder"
const MARK = "tenonSync"
const VERSION_MARK = "v1"
const FOLDER_MARK = "folder-v1"
const NO_PARENT = "-"
const NO_DIRECTORY = "."
const PART_LIMIT = 100
const LISTING_FIELDS = "nextPageToken,incompleteSearch,files(id,name,size,createdTime,appProperties)"
const ATTEMPTS = 5
const BACKOFF_MS = 100
const RETRY_BUDGET_MS = 2_000
const MIN_ATTEMPT_MS = 100
const REQUEST_TIMEOUT_MS = 15_000
const READ_BACK_DELAYS_MS = [150, 300, 600]
const MAX_PAGES = 1_000
const FREE_WRITE_ATTEMPTS = 5
const DOWNLOAD_ATTEMPTS = 3
const RETRIED_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"])

const Listed = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  size: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  createdTime: Schema.String,
  appProperties: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
type Listed = typeof Listed.Type
const decodeListing = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      files: Schema.optional(Schema.Array(Listed)),
      nextPageToken: Schema.optional(Schema.String),
      incompleteSearch: Schema.optional(Schema.Boolean),
    }),
  ),
)
const decodeFailure = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      error: Schema.Struct({
        errors: Schema.optional(Schema.Array(Schema.Struct({ reason: Schema.optional(Schema.String) }))),
      }),
    }),
  ),
)

type Version = {
  id: string
  created: number
  name: string
  parent: string
  writer: string
  sha256: string
  size: number
}

type Input = {
  token: () => Promise<string>
  endpoint?: string
  folder?: string
}

type Limits = { requestTimeoutMs: number; readBackDelaysMs: ReadonlyArray<number> }

const refused = new WeakSet<SyncError>()

export function driveStore(input: Input): Store {
  return limitedDriveStore(input, { requestTimeoutMs: REQUEST_TIMEOUT_MS, readBackDelaysMs: READ_BACK_DELAYS_MS })
}

export function limitedDriveStore(input: Input, limits: Limits): Store {
  const store = unguardedDriveStore(input, limits)
  return {
    get: (name) => store.get(name).catch(unavailable),
    put: (name, bytes, options) => store.put(name, bytes, options).catch(unavailable),
    list: (prefix) => store.list(prefix).catch(unavailable),
    remove: (name) => store.remove(name).catch(unavailable),
  }
}

function unguardedDriveStore(input: Input, limits: Limits): Store {
  const endpoint = (input.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "")
  const folderName = input.folder?.trim() || DRIVE_FOLDER
  const cache: { folder?: Promise<string> } = {}

  const send = async (
    url: string,
    init: { method: string; body?: Uint8Array; type?: string },
    attempt: number,
    retryUntil?: number,
  ): Promise<Response> => {
    const limit = Math.min(Date.now() + limits.requestTimeoutMs, retryUntil ?? Number.POSITIVE_INFINITY)
    const token = await within(
      Promise.resolve()
        .then(() => input.token())
        .catch((error: unknown) => {
          throw error instanceof SyncError ? error : syncError("unauthorized", "No Google Drive token is available")
        }),
      limit,
    )
    const response = await fetch(url, {
      method: init.method,
      headers: { authorization: `Bearer ${token}`, ...(init.type ? { "content-type": init.type } : {}) },
      ...(init.body ? { body: Uint8Array.from(init.body) } : {}),
      signal: AbortSignal.timeout(Math.max(1, limit - Date.now())),
    }).catch(() => undefined)
    const reason = response?.status === 403 ? await reasonOf(response) : undefined
    const retried =
      response === undefined ||
      response.status >= 500 ||
      response.status === 429 ||
      (reason !== undefined && RETRIED_REASONS.has(reason))
    if (response && !retried) return refuseAuth(response, reason)
    await response?.arrayBuffer().catch(() => undefined)
    const deadline = retryUntil ?? Date.now() + RETRY_BUDGET_MS
    const delay = BACKOFF_MS * 2 ** attempt
    if (attempt + 1 >= ATTEMPTS || Date.now() + delay + MIN_ATTEMPT_MS > deadline)
      throw syncError("unavailable", "Google Drive is unavailable")
    await timers.setTimeout(delay)
    return send(url, init, attempt + 1, deadline)
  }

  const listPages = async (
    q: string,
    pageToken: string | undefined,
    seen: ReadonlySet<string>,
    found: ReadonlyArray<Listed>,
  ): Promise<ReadonlyArray<Listed>> => {
    if (seen.size >= MAX_PAGES) throw syncError("unavailable", "Google Drive listed too many pages")
    const query = new URLSearchParams({
      q,
      spaces: "drive",
      corpora: "user",
      pageSize: "1000",
      fields: LISTING_FIELDS,
      ...(pageToken ? { pageToken } : {}),
    })
    const response = await send(`${endpoint}/drive/v3/files?${query.toString()}`, { method: "GET" }, 0)
    if (!response.ok) return refuse(response, "Google Drive could not list files")
    const listing = Option.getOrUndefined(decodeListing(await response.text().catch(() => "")))
    if (!listing || listing.incompleteSearch === true)
      throw syncError("unavailable", "Google Drive sent a listing that cannot be read")
    const all = [...found, ...(listing.files ?? [])]
    if (!listing.nextPageToken) return all
    if (seen.has(listing.nextPageToken)) throw syncError("unavailable", "Google Drive repeated a listing page")
    return listPages(q, listing.nextPageToken, new Set([...seen, listing.nextPageToken]), all)
  }

  const listAll = (q: string) => listPages(q, undefined, new Set(), [])

  const versionsOf = async (name: string) => {
    const { dir, base } = partsOf(name)
    const listed = await listAll(
      `${has(MARK, VERSION_MARK)} and ${has("dir", dir)} and ${has("base", base)} and trashed = false`,
    )
    return listed.flatMap((item) => versionOf(item) ?? []).filter((version) => version.name === name)
  }

  const findFolder = async () => {
    const listed = await listAll(`mimeType = '${FOLDER_TYPE}' and ${has(MARK, FOLDER_MARK)} and trashed = false`)
    const folders = listed.flatMap((item) => {
      const created = Date.parse(item.createdTime)
      return Number.isFinite(created) ? [{ id: item.id, created, named: item.name === folderName }] : []
    })
    return folders.toSorted((left, right) => Number(right.named) - Number(left.named) || inOrder(left, right))[0]
  }

  const locateFolder = async () => {
    const found = await findFolder()
    if (found) return found.id
    const response = await send(
      `${endpoint}/drive/v3/files?fields=id`,
      {
        method: "POST",
        type: "application/json; charset=UTF-8",
        body: new TextEncoder().encode(
          JSON.stringify({ name: folderName, mimeType: FOLDER_TYPE, appProperties: { [MARK]: FOLDER_MARK } }),
        ),
      },
      0,
    )
    if (!response.ok) return refuse(response, "Google Drive could not make the sync folder")
    await response.arrayBuffer().catch(() => undefined)
    const made = await findFolder()
    if (!made) throw syncError("unavailable", "Google Drive did not show the sync folder")
    return made.id
  }

  const folder = () => {
    cache.folder ??= locateFolder().catch((error: unknown) => {
      cache.folder = undefined
      throw error
    })
    return cache.folder
  }

  const create = async (
    name: string,
    bytes: Uint8Array,
    parent: string,
    writer: string,
    retried: boolean,
  ): Promise<void> => {
    const { dir, base } = partsOf(name)
    const boundary = `tenon-${randomBytes(12).toString("hex")}`
    const metadata = {
      name: `Tenon sync - ${name.split("/").join(" - ")}`,
      mimeType: "application/octet-stream",
      parents: [await folder()],
      appProperties: { [MARK]: VERSION_MARK, dir, base, parent, writer, sha256: hashOf(bytes) },
    }
    const encoder = new TextEncoder()
    const body = Buffer.concat([
      encoder.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      encoder.encode(`\r\n--${boundary}--`),
    ])
    const response = await send(
      `${endpoint}/upload/drive/v3/files?uploadType=multipart&fields=id`,
      { method: "POST", type: `multipart/related; boundary=${boundary}`, body },
      0,
    ).catch((error: unknown) => {
      if (error instanceof SyncError && refused.has(error)) throw error
      return undefined
    })
    if (!response) return
    if (response.status === 404 && !retried) {
      await response.arrayBuffer().catch(() => undefined)
      cache.folder = undefined
      return create(name, bytes, parent, writer, true)
    }
    if (!response.ok) return refuse(response, "Google Drive could not write the file")
    await response.arrayBuffer().catch(() => undefined)
  }

  const readBack = async (
    name: string,
    writer: string,
    delays: ReadonlyArray<number>,
  ): Promise<ReadonlyArray<Version> | undefined> => {
    const versions = await versionsOf(name)
    if (versions.some((version) => version.writer === writer)) return versions
    const [delay, ...rest] = delays
    if (delay === undefined) return undefined
    await timers.setTimeout(delay)
    return readBack(name, writer, rest)
  }

  const remove = (id: string) =>
    send(`${endpoint}/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE" }, 0).then(async (response) => {
      if (!response.ok && response.status !== 404) await refuse(response, "Google Drive could not remove a file")
      await response.arrayBuffer().catch(() => undefined)
    })

  const removeAll = async (versions: ReadonlyArray<Version>, keep: string | undefined) => {
    const path = pathOf(versions)
    const onPath = new Set(path.map((version) => version.id))
    await Promise.all(versions.filter((version) => !onPath.has(version.id)).map((version) => remove(version.id)))
    await path
      .filter((version) => version.id !== keep)
      .reduce((previous, version) => previous.then(() => remove(version.id)), Promise.resolve())
  }

  const write = async (name: string, bytes: Uint8Array, parent: string) => {
    const writer = randomBytes(16).toString("hex")
    await create(name, bytes, parent, writer, false)
    const after = await readBack(name, writer, limits.readBackDelaysMs)
    if (!after) throw syncError("unavailable", "Google Drive did not show the file it was sent")
    const winner = pathOf(after).at(-1)
    if (winner?.writer === writer) {
      await removeAll(after, winner.id).catch(() => undefined)
      return { generation: winner.id }
    }
    await Promise.all(
      after.filter((version) => version.writer === writer).map((version) => remove(version.id).catch(() => undefined)),
    )
    throw syncError("conflict", "The file changed since it was read")
  }

  const writeFree = async (name: string, bytes: Uint8Array, attempt: number): Promise<{ generation: string }> => {
    const current = pathOf(await versionsOf(name)).at(-1)
    return write(name, bytes, current?.id ?? NO_PARENT).catch((error: unknown) => {
      if (!(error instanceof SyncError) || error.code !== "conflict" || attempt + 1 >= FREE_WRITE_ATTEMPTS) throw error
      return writeFree(name, bytes, attempt + 1)
    })
  }

  const download = async (
    name: string,
    attempt: number,
  ): Promise<{ bytes: Uint8Array; generation: string } | undefined> => {
    const current = pathOf(await versionsOf(name)).at(-1)
    if (!current) return undefined
    const response = await send(
      `${endpoint}/drive/v3/files/${encodeURIComponent(current.id)}?alt=media`,
      { method: "GET" },
      0,
    )
    if (response.status === 404 && attempt + 1 < DOWNLOAD_ATTEMPTS) {
      await response.arrayBuffer().catch(() => undefined)
      return download(name, attempt + 1)
    }
    if (!response.ok) return refuse(response, "Google Drive could not read the file")
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (hashOf(bytes) !== current.sha256)
      throw syncError("unreadable", "A file in Google Drive was changed outside Tenon")
    return { bytes, generation: current.id }
  }

  return {
    async get(name) {
      partsOf(name)
      return download(name, 0)
    },
    async put(name, bytes, options) {
      partsOf(name)
      requireBytes(bytes)
      const expected = options?.ifGeneration
      if (expected === undefined) return writeFree(name, bytes, 0)
      const current = pathOf(await versionsOf(name)).at(-1)
      if (expected === null ? current !== undefined : current?.id !== expected)
        throw syncError("conflict", "The file changed since it was read")
      return write(name, bytes, current?.id ?? NO_PARENT)
    },
    async list(prefix) {
      requirePrefix(prefix)
      const listed = await listAll(`${has(MARK, VERSION_MARK)} and trashed = false`)
      const byStoreName = Map.groupBy(
        listed.flatMap((item) => versionOf(item) ?? []).filter((version) => version.name.startsWith(prefix)),
        (version) => version.name,
      )
      return [...byStoreName.entries()]
        .flatMap(([name, versions]) => {
          const winner = pathOf(versions).at(-1)
          return winner ? [{ name, generation: winner.id, size: winner.size }] : []
        })
        .sort(byName)
    },
    async remove(name) {
      partsOf(name)
      await removeAll(await versionsOf(name), undefined)
    },
  }
}

function partsOf(name: string) {
  const parts = requireName(name).split("/")
  const base = parts.at(-1) ?? ""
  const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : NO_DIRECTORY
  if (base.length > PART_LIMIT || dir.length > PART_LIMIT)
    throw syncError("invalid_name", `A store name's folder and last part are at most ${PART_LIMIT} characters`)
  return { dir, base }
}

function versionOf(item: Listed): Version | undefined {
  const properties = item.appProperties ?? {}
  const created = Date.parse(item.createdTime)
  const size = Number(item.size ?? Number.NaN)
  const dir = properties.dir
  const base = properties.base
  if (properties[MARK] !== VERSION_MARK || !Number.isFinite(created) || !Number.isSafeInteger(size) || size < 0)
    return undefined
  if (typeof dir !== "string" || typeof base !== "string" || !isPart(base)) return undefined
  if (dir !== NO_DIRECTORY && !isName(dir)) return undefined
  if (typeof properties.parent !== "string" || properties.parent === "") return undefined
  if (!/^[0-9a-f]{32}$/.test(properties.writer ?? "") || !/^[0-9a-f]{64}$/.test(properties.sha256 ?? ""))
    return undefined
  return {
    id: item.id,
    created,
    name: dir === NO_DIRECTORY ? base : `${dir}/${base}`,
    parent: properties.parent,
    writer: properties.writer,
    sha256: properties.sha256,
    size,
  }
}

function pathOf(versions: ReadonlyArray<Version>): Version[] {
  const ids = new Set(versions.map((version) => version.id))
  const root = versions
    .filter((version) => version.parent === NO_PARENT || !ids.has(version.parent))
    .toSorted(inOrder)[0]
  if (!root) return []
  return extend(versions, [root], new Set([root.id]))
}

function extend(versions: ReadonlyArray<Version>, path: Version[], seen: ReadonlySet<string>): Version[] {
  const tip = path.at(-1)
  const next = versions.filter((version) => version.parent === tip?.id && !seen.has(version.id)).toSorted(inOrder)[0]
  if (!next) return path
  return extend(versions, [...path, next], new Set([...seen, next.id]))
}

function inOrder(left: { created: number; id: string }, right: { created: number; id: string }) {
  if (left.created !== right.created) return left.created - right.created
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}

function has(key: string, value: string) {
  return `appProperties has { key='${key}' and value='${value}' }`
}

function hashOf(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function reasonOf(response: Response) {
  const failure = Option.getOrUndefined(decodeFailure(await response.text().catch(() => "")))
  return failure?.error.errors?.[0]?.reason ?? ""
}

function within<A>(promise: Promise<A>, deadline: number) {
  return new Promise<A>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(syncError("unavailable", "Google Drive did not answer in time")),
      Math.max(1, deadline - Date.now()),
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function unavailable(error: unknown): never {
  if (error instanceof SyncError) throw error
  throw syncError("unavailable", "Google Drive did not answer in time")
}

async function refuseAuth(response: Response, reason: string | undefined) {
  if (response.status !== 401 && response.status !== 403) return response
  await response.arrayBuffer().catch(() => undefined)
  const error =
    reason === "storageQuotaExceeded"
      ? syncError("unavailable", "Google Drive is full")
      : syncError("unauthorized", "Google Drive refused the token")
  refused.add(error)
  throw error
}

async function refuse(response: Response, message: string): Promise<never> {
  await response.arrayBuffer().catch(() => undefined)
  const error = syncError("unavailable", message)
  if (response.status >= 400 && response.status < 500) refused.add(error)
  throw error
}
