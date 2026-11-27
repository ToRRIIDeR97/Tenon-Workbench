export const DEFAULT_PORT = 47100
const SESSION_KEY = "tenon.companion"
const PAIR_PREFIX = "tenon://pair?"
const REFUSALS = new Set(["bad_code", "expired", "locked", "invalid_name"])

export type Pairing = { url: string; id: string; name: string; token: string }

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function normalizeServer(input: string) {
  const text = input.trim()
  if (!text) return undefined
  const typedScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
  const url = parseURL(typedScheme ? text : `http://${text}`)
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return undefined
  if (!typedScheme && !url.port) url.port = String(DEFAULT_PORT)
  return url.origin
}

export function readPairing(link: string) {
  if (!link.startsWith(PAIR_PREFIX)) return undefined
  const params = new URLSearchParams(link.slice(PAIR_PREFIX.length))
  const url = normalizeServer(params.get("server") ?? "")
  const code = params.get("code")
  if (!url || !code) return undefined
  return { url, code }
}

export async function pairDevice(fetch: Fetch, input: { url: string; code: string; name: string }): Promise<Pairing> {
  const response = await fetch(`${input.url}/remote/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: input.code.replace(/[\s-]/g, "").toUpperCase(), name: input.name }),
  }).catch(() => {
    throw new Error("unreachable")
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (response.status === 429) throw new Error("too_many_attempts")
  if (!response.ok) {
    const code = body && typeof body === "object" && "code" in body ? String(body.code) : ""
    throw new Error(REFUSALS.has(code) ? code : "refused")
  }
  const paired = body as Partial<Pairing>
  if (typeof paired.token !== "string" || typeof paired.id !== "string") throw new Error("refused")
  return {
    url: input.url,
    id: paired.id,
    name: typeof paired.name === "string" ? paired.name : input.name,
    token: paired.token,
  }
}

export function bearerFetch(fetch: Fetch, pairing: { url: string; token: string }): Fetch {
  const origin = new URL(pairing.url).origin
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== origin || url.pathname === "/remote/pair") return fetch(input, init)
    url.searchParams.delete("auth_token")
    const headers = new Headers(request.headers)
    headers.set("authorization", `Bearer ${pairing.token}`)
    const hasBody = request.method !== "GET" && request.method !== "HEAD"
    return fetch(url, {
      method: request.method,
      headers,
      signal: request.signal,
      redirect: request.redirect,
      cache: request.cache,
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
    })
  }
}

export function companionSession(store: {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}) {
  return {
    async load(): Promise<Pairing | undefined> {
      const text = await store.get(SESSION_KEY)
      if (!text) return undefined
      const value: unknown = (() => {
        try {
          return JSON.parse(text)
        } catch {
          return undefined
        }
      })()
      if (!value || typeof value !== "object") return undefined
      const pairing = value as Partial<Pairing>
      const url = typeof pairing.url === "string" ? normalizeServer(pairing.url) : undefined
      if (!url || typeof pairing.token !== "string" || typeof pairing.id !== "string") return undefined
      return { url, id: pairing.id, name: typeof pairing.name === "string" ? pairing.name : "", token: pairing.token }
    },
    save: (pairing: Pairing) => store.set(SESSION_KEY, JSON.stringify(pairing)),
    signOut: () => store.remove(SESSION_KEY),
  }
}

export function threadDirectories(answer: unknown) {
  const list = answer && typeof answer === "object" && "data" in answer && Array.isArray(answer.data) ? answer.data : []
  const directories = list.flatMap((item: unknown) => {
    const directory = directoryOf(item)
    return directory ? [directory] : []
  })
  return [...new Set(directories)]
}

function directoryOf(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined
  if ("directory" in item && typeof item.directory === "string" && item.directory) return item.directory
  if (!("location" in item) || !item.location || typeof item.location !== "object") return undefined
  const location = item.location
  return "directory" in location && typeof location.directory === "string" && location.directory
    ? location.directory
    : undefined
}

export function seedWorkspaces(stored: string | null, directories: ReadonlyArray<string>) {
  if (directories.length === 0) return undefined
  const value: unknown = (() => {
    try {
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  })()
  const state = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const projects =
    state.projects && typeof state.projects === "object" ? (state.projects as Record<string, unknown>) : {}
  if (Array.isArray(projects.local) && projects.local.length > 0) return undefined
  return JSON.stringify({
    ...state,
    projects: { ...projects, local: directories.map((worktree) => ({ worktree, expanded: true })) },
  })
}

function parseURL(value: string) {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}
