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

type Client = { server: ServerConnection.Any; fetch?: typeof globalThis.fetch }

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
  status: (client: Client) => call<ThreadSyncServerStatus>(client, "GET", "/api/thread-sync"),
  configure: (client: Client, change: { enabled?: boolean; driveFolder?: string; machineName?: string }) =>
    call<ThreadSyncServerStatus>(client, "PUT", "/api/thread-sync", change),
  threads: (client: Client) => call<StoredThread[]>(client, "GET", "/api/thread-sync/threads"),
  continueHere: (client: Client, sessionID: string, directory: string) =>
    call<{ applied: number; head: number }>(
      client,
      "POST",
      `/api/thread-sync/threads/${encodeURIComponent(sessionID)}/continue`,
      { directory },
    ),
}

async function call<T>(client: Client, method: string, path: string, body?: unknown): Promise<T> {
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
