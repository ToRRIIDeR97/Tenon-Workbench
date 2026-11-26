import timers from "node:timers/promises"
import { SyncError, syncError } from "./error"
import { byName, requireBytes, requireName, requirePrefix } from "./store"
import type { Store } from "./store"

const DEFAULT_ENDPOINT = "https://storage.googleapis.com"
const ATTEMPTS = 5
const BACKOFF_MS = 100
const RETRY_BUDGET_MS = 2_000
const MIN_ATTEMPT_MS = 100

type Listing = {
  items?: Array<{ name?: string; generation?: string | number; size?: string | number }>
  nextPageToken?: string
}

export function gcsStore(input: {
  bucket: string
  token: () => Promise<string>
  endpoint?: string
  prefix?: string
}): Store {
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
    const token = await Promise.resolve()
      .then(() => input.token())
      .catch((error: unknown) => {
        throw error instanceof SyncError ? error : syncError("unauthorized", "No Cloud Storage token is available")
      })
    const response = await fetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/octet-stream" } : {}),
      },
      ...(init.body ? { body: Uint8Array.from(init.body) } : {}),
      ...(retryUntil === undefined ? {} : { signal: AbortSignal.timeout(Math.max(1, retryUntil - Date.now())) }),
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

  const listPage = async (wanted: string, pageToken: string | undefined): Promise<NonNullable<Listing["items"]>> => {
    const response = await send(
      `${endpoint}/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(wanted)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      { method: "GET" },
      0,
    )
    if (!response.ok) return refuse(response, "Cloud Storage could not list objects")
    const listing = (await response.json().catch(() => ({}))) as Listing
    const items = listing.items ?? []
    if (!listing.nextPageToken) return items
    return [...items, ...(await listPage(wanted, listing.nextPageToken))]
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
      if (!generation) throw syncError("unavailable", "Cloud Storage sent no generation")
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
      const written = (await response.json().catch(() => ({}))) as { generation?: string | number }
      if (written.generation === undefined) throw syncError("unavailable", "Cloud Storage sent no generation")
      return { generation: String(written.generation) }
    },
    async list(wanted) {
      requirePrefix(wanted)
      const stored = prefix ? `${requireName(prefix)}/` : ""
      const items = await listPage(`${stored}${wanted}`, undefined)
      return items
        .filter((item) => typeof item.name === "string" && item.name.startsWith(`${stored}${wanted}`))
        .map((item) => ({
          name: (item.name ?? "").slice(stored.length),
          generation: String(item.generation ?? ""),
          size: Number(item.size ?? 0),
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

async function refuseAuth(response: Response) {
  if (response.status !== 401 && response.status !== 403) return response
  await response.arrayBuffer().catch(() => undefined)
  throw syncError("unauthorized", "Cloud Storage refused the token")
}

async function refuse(response: Response, message: string): Promise<never> {
  await response.arrayBuffer().catch(() => undefined)
  throw syncError("unavailable", message)
}
