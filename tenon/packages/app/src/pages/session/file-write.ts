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

export async function revertFiles(input: {
  server: ServerConnection.Any
  fetch?: typeof globalThis.fetch
  directory: string
  files: ReadonlyArray<{ file: string; patch: string; status: "added" | "deleted" | "modified" }>
}): Promise<Array<{ file: string; result: "reverted" | "changed" | "failed" }>> {
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
  const failed = () => input.files.map((item) => ({ file: item.file, result: "failed" as const }))
  const response = await (input.fetch ?? globalThis.fetch)(`${input.server.http.url.replace(/\/+$/, "")}/file/revert`, {
    method: "POST",
    headers,
    body: JSON.stringify({ files: input.files }),
  }).catch(() => undefined)
  if (!response?.ok) return failed()
  const body: unknown = await response.json().catch(() => undefined)
  if (!Array.isArray(body)) return failed()
  return body.flatMap((item) =>
    item &&
    typeof item === "object" &&
    typeof item.file === "string" &&
    ["reverted", "changed", "failed"].includes(item.result)
      ? [{ file: item.file as string, result: item.result as "reverted" | "changed" | "failed" }]
      : [],
  )
}
