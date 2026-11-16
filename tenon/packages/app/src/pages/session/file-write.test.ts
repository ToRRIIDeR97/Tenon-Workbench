import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import { writeFileText } from "./file-write"

const server = {
  http: { url: "http://127.0.0.1:4096/prefix/", username: "tenon", password: "pw" },
} as ServerConnection.Any

function call(status: number, body: unknown) {
  const sent: { url: string; init?: RequestInit }[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as typeof globalThis.fetch
  const result = writeFileText({
    server,
    fetch,
    directory: "C:\\work\\notes",
    path: "docs/plan.md",
    content: "# New",
    expectedHash: "abc",
  })
  return { sent, result }
}

describe("writeFileText", () => {
  test("keeps the server URL's path prefix and sends the folder, credentials and body", async () => {
    const { sent, result } = call(200, { hash: "def" })
    expect(await result).toEqual({ status: "saved", hash: "def" })
    expect(sent[0].url).toBe("http://127.0.0.1:4096/prefix/file/content")
    const headers = new Headers(sent[0].init?.headers)
    expect(headers.get("x-opencode-directory")).toBe(encodeURIComponent("C:\\work\\notes"))
    expect(headers.get("authorization")).toStartWith("Basic ")
    expect(sent[0].init?.method).toBe("PUT")
    expect(JSON.parse(String(sent[0].init?.body))).toEqual({
      path: "docs/plan.md",
      content: "# New",
      expectedHash: "abc",
    })
  })

  test("a 409 carries the current hash; other errors fail", async () => {
    expect(await call(409, { name: "FileConflictError", currentHash: "now" }).result).toEqual({
      status: "conflict",
      currentHash: "now",
    })
    expect(await call(400, { name: "FileInvalidError" }).result).toEqual({ status: "failed", code: 400 })
  })
})
