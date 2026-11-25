import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

export type FileWriteResult =
  | { status: "saved"; hash: string }
  | { status: "conflict"; currentHash: string }
  | { status: "failed"; code: number }

export async function writeFileText(input: {
  server: ServerConnection.Any
  fetch?: typeof globalThis.fetch
  directory: string
  path: string
  content: string
  expectedHash: string
}): Promise<FileWriteResult> {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-opencode-directory": encodeURIComponent(input.directory),
  })
  if (input.server.http.password)
    headers.set(
      "Authorization",
      `Basic ${authTokenFromCredentials({ username: input.server.http.username, password: input.server.http.password })}`,
    )
  const url = `${input.server.http.url.replace(/\/+$/, "")}/file/content`
  const response = await (input.fetch ?? globalThis.fetch)(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ path: input.path, content: input.content, expectedHash: input.expectedHash }),
  }).catch(() => undefined)
  if (!response) return { status: "failed", code: 0 }
  const body: unknown = await response.json().catch(() => undefined)
  const field = (key: string) =>
    body && typeof body === "object" && key in body && typeof (body as Record<string, unknown>)[key] === "string"
      ? ((body as Record<string, unknown>)[key] as string)
      : undefined
  if (response.status === 409) {
    const currentHash = field("currentHash")
    return currentHash ? { status: "conflict", currentHash } : { status: "failed", code: 409 }
  }
  if (!response.ok) return { status: "failed", code: response.status }
  return { status: "saved", hash: field("hash") ?? "" }
}
