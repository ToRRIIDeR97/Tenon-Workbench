import timers from "node:timers/promises"
import { Option, Schema } from "effect"
import { SyncError, syncError } from "./error"
import { byName, requireBytes, requireName, requirePrefix } from "./store"
import type { Store } from "./store"

const DEFAULT_ENDPOINT = "https://storage.googleapis.com"
const ATTEMPTS = 5
const BACKOFF_MS = 100
const RETRY_BUDGET_MS = 2_000
const MIN_ATTEMPT_MS = 100
const REQUEST_TIMEOUT_MS = 15_000

const MAX_PAGES = 1_000

const Integer = Schema.Union([Schema.String, Schema.Number])
const ListedItem = Schema.Struct({ name: Schema.String, generation: Integer, size: Integer })
type ListedItem = typeof ListedItem.Type
const decodeListing = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      items: Schema.optional(Schema.Array(ListedItem)),
      nextPageToken: Schema.optional(Schema.String),
    }),
  ),
)
const decodeWritten = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ generation: Integer })))

type Input = {
  bucket: string
  token: () => Promise<string>
  endpoint?: string
  prefix?: string
}

export function gcsStore(input: Input): Store {
  return limitedGcsStore(input, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
}

export function limitedGcsStore(input: Input, limits: { requestTimeoutMs: number }): Store {
  const store = unguardedGcsStore(input, limits)
  return {
    get: (name) => store.get(name).catch(unavailable),
    put: (name, bytes, options) => store.put(name, bytes, options).catch(unavailable),
    list: (prefix) => store.list(prefix).catch(unavailable),
    remove: (name) => store.remove(name).catch(unavailable),
  }
}

function unguardedGcsStore(input: Input, limits: { requestTimeoutMs: number }): Store {
  const endpoint = (input.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "")
  const bucket = encodeURIComponent(input.bucket)
  const prefix = (input.prefix ?? "").replace(/\/+$/, "")
  const full = (name: string) => (prefix ? `${requireName(prefix)}/${name}` : name)
  const objectURL = (name: string) => `${endpoint}/storage/v1/b/${bucket}/o/${encodeURIComponent(full(name))}`

  const send = async (
    url: string,
    init: { method: string; body?: Uint8Array },
    attempt: number,
    retryUntil?: number,
  ): Promise<Response> => {
    const limit = Math.min(Date.now() + limits.requestTimeoutMs, retryUntil ?? Number.POSITIVE_INFINITY)
    const token = await within(
      Promise.resolve()
        .then(() => input.token())
        .catch((error: unknown) => {
          throw error instanceof SyncError ? error : syncError("unauthorized", "No Cloud Storage token is available")
        }),
      limit,
    )
    const response = await fetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/octet-stream" } : {}),
      },
      ...(init.body ? { body: Uint8Array.from(init.body) } : {}),
      signal: AbortSignal.timeout(Math.max(1, limit - Date.now())),
    }).catch(() => undefined)
    if (response && response.status < 500 && response.status !== 429) return refuseAuth(response)
    await response?.arrayBuffer().catch(() => undefined)
    const deadline = retryUntil ?? Date.now() + RETRY_BUDGET_MS
    const delay = BACKOFF_MS * 2 ** attempt
    if (attempt + 1 >= ATTEMPTS || Date.now() + delay + MIN_ATTEMPT_MS > deadline)
      throw syncError("unavailable", "Cloud Storage is unavailable")
    await timers.setTimeout(delay)
    return send(url, init, attempt + 1, deadline)
  }

  const listPage = async (
    wanted: string,
    pageToken: string | undefined,
    seen: ReadonlySet<string>,
  ): Promise<ReadonlyArray<ListedItem>> => {
    if (seen.size >= MAX_PAGES) throw syncError("unavailable", "Cloud Storage listed too many pages")
    const response = await send(
      `${endpoint}/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(wanted)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      { method: "GET" },
      0,
    )
    if (!response.ok) return refuse(response, "Cloud Storage could not list objects")
    const listing = Option.getOrUndefined(decodeListing(await response.text().catch(() => "")))
    if (!listing) throw syncError("unavailable", "Cloud Storage sent a listing that cannot be read")
    const items = listing.items ?? []
    if (!listing.nextPageToken) return items
    if (seen.has(listing.nextPageToken)) throw syncError("unavailable", "Cloud Storage repeated a listing page")
    return [...items, ...(await listPage(wanted, listing.nextPageToken, new Set([...seen, listing.nextPageToken])))]
  }

  return {
    async get(name) {
      requireName(name)
      const response = await send(`${objectURL(name)}?alt=media`, { method: "GET" }, 0)
      if (response.status === 404) {
        await response.arrayBuffer().catch(() => undefined)
        return undefined
      }
      if (!response.ok) return refuse(response, "Cloud Storage could not read the object")
      const generation = response.headers.get("x-goog-generation")
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (!generation || !/^\d+$/.test(generation)) throw syncError("unavailable", "Cloud Storage sent no generation")
      return { bytes, generation }
    },
    async put(name, bytes, options) {
      requireName(name)
      requireBytes(bytes)
      const condition = options?.ifGeneration === null ? "0" : options?.ifGeneration
      if (typeof condition === "string" && !/^\d+$/.test(condition))
        throw syncError("conflict", "The object changed since it was read")
      const response = await send(
        `${endpoint}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(full(name))}${condition === undefined ? "" : `&ifGenerationMatch=${condition}`}`,
        { method: "POST", body: bytes },
        0,
      )
      if (response.status === 412) {
        await response.arrayBuffer().catch(() => undefined)
        throw syncError("conflict", "The object changed since it was read")
      }
      if (!response.ok) return refuse(response, "Cloud Storage could not write the object")
      const written = Option.getOrUndefined(decodeWritten(await response.text().catch(() => "")))
      if (!written || !/^\d+$/.test(String(written.generation)))
        throw syncError("unavailable", "Cloud Storage sent a reply that cannot be read")
      return { generation: String(written.generation) }
    },
    async list(wanted) {
      requirePrefix(wanted)
      const stored = prefix ? `${requireName(prefix)}/` : ""
      const items = await listPage(`${stored}${wanted}`, undefined, new Set())
      if (!items.every((item) => /^\d+$/.test(String(item.generation)) && Number.isSafeInteger(Number(item.size))))
        throw syncError("unavailable", "Cloud Storage sent a listing that cannot be read")
      return items
        .filter((item) => item.name.startsWith(`${stored}${wanted}`))
        .map((item) => ({
          name: item.name.slice(stored.length),
          generation: String(item.generation),
          size: Number(item.size),
        }))
        .sort(byName)
    },
    async remove(name) {
      requireName(name)
      const response = await send(objectURL(name), { method: "DELETE" }, 0)
      if (!response.ok && response.status !== 404) await refuse(response, "Cloud Storage could not remove the object")
      await response.arrayBuffer().catch(() => undefined)
    },
  }
}

function within<A>(promise: Promise<A>, deadline: number) {
  return new Promise<A>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(syncError("unavailable", "Cloud Storage did not answer in time")),
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
  throw syncError("unavailable", "Cloud Storage did not answer in time")
}

async function refuseAuth(response: Response) {
  if (response.status !== 401 && response.status !== 403) return response
  await response.arrayBuffer().catch(() => undefined)
  throw syncError("unauthorized", "Cloud Storage refused the token")
}

async function refuse(response: Response, message: string): Promise<never> {
  await response.arrayBuffer().catch(() => undefined)
  throw syncError("unavailable", message)
}
