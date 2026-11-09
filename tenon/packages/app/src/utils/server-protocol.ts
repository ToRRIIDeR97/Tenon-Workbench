import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export type ServerProtocol = "v1" | "v2"

function headers(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

async function probe(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  const response = await fetch(new URL(path, server.url), {
    headers: headers(server),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") return
  return value
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<ServerProtocol> {
  return (await detectServerCapabilities(server, fetch)).protocol
}

// V2 has no equivalent of the instance routes /path, /vcs and /pty/shells. A V1 server serves them, and so does
// the managed sidecar, which reports V2 but still answers /global/health (`legacyProjectsAndMcp`).
export async function servesLegacyRoutes(input: {
  protocol: Promise<ServerProtocol>
  legacyProjectsAndMcp: Promise<boolean>
}) {
  return (await input.protocol) === "v1" || (await input.legacyProjectsAndMcp)
}

export async function detectServerCapabilities(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<{ protocol: ServerProtocol; legacyProjectsAndMcp: boolean }> {
  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  if (current && "pid" in current && typeof current.pid === "number")
    return { protocol: "v2", legacyProjectsAndMcp: false }

  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  if (
    current &&
    "healthy" in current &&
    current.healthy === true &&
    legacy &&
    "healthy" in legacy &&
    legacy.healthy === true
  )
    return { protocol: "v2", legacyProjectsAndMcp: true }
  if (legacy && "healthy" in legacy && legacy.healthy === true) return { protocol: "v1", legacyProjectsAndMcp: true }
  if (current && "healthy" in current && current.healthy === true) return { protocol: "v1", legacyProjectsAndMcp: true }
  return { protocol: "v2", legacyProjectsAndMcp: false }
}
