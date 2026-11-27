import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import type { StoredThread } from "./thread-sync-model"

export type ThreadSyncServerStatus = {
  ready: boolean
  enabled: boolean
  driveFolder: string
  machine: { id: string; name: string }
  missing: Array<"key" | "store">
  lastError: string | null
}

export type OwnerClient = { server: ServerConnection.Any; fetch?: typeof globalThis.fetch }

export class ThreadSyncRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = "ThreadSyncRequestError"
  }
}

export const threadSyncApi = {
  status: (client: OwnerClient) => ownerRequest<ThreadSyncServerStatus>(client, "GET", "/api/thread-sync"),
  configure: (client: OwnerClient, change: { enabled?: boolean; driveFolder?: string; machineName?: string }) =>
    ownerRequest<ThreadSyncServerStatus>(client, "PUT", "/api/thread-sync", change),
  threads: (client: OwnerClient) => ownerRequest<StoredThread[]>(client, "GET", "/api/thread-sync/threads"),
  continueHere: (client: OwnerClient, sessionID: string, directory: string) =>
    ownerRequest<{ applied: number; head: number }>(
      client,
      "POST",
      `/api/thread-sync/threads/${encodeURIComponent(sessionID)}/continue`,
      { directory },
    ),
}

export async function ownerRequest<T>(client: OwnerClient, method: string, path: string, body?: unknown): Promise<T> {
  const headers = new Headers({ Accept: "application/json" })
  if (body !== undefined) headers.set("Content-Type", "application/json")
  if (client.server.http.password)
    headers.set(
      "Authorization",
      `Basic ${authTokenFromCredentials({ username: client.server.http.username, password: client.server.http.password })}`,
    )
  const response = await (client.fetch ?? globalThis.fetch)(new URL(path, client.server.http.url), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const answer: unknown = await response.json().catch(() => undefined)
    const code =
      answer && typeof answer === "object" && "code" in answer && typeof answer.code === "string"
        ? answer.code
        : `http_${response.status}`
    throw new ThreadSyncRequestError(response.status, code)
  }
  return (await response.json()) as T
}
