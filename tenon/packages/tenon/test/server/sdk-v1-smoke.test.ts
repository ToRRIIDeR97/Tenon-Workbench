import { afterEach, describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../../src/server/server"
import { tmpdir, disposeAllInstances } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function client(directory: string) {
  return createOpencodeClient({
    baseUrl: "http://test",
    directory,
    fetch: ((req: Request) => Server.Default().app.fetch(req)) as unknown as typeof fetch,
  })
}

describe("v1 SDK runtime smoke", () => {
  test("session.list reaches the server and returns 200", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)
    const result = await sdk.session.list()
    expect(result.error).toBeUndefined()
    expect(Array.isArray(result.data)).toBe(true)
  })

  test("path.get reaches the server and returns 200", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)
    const result = await sdk.path.get()
    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
  })

  test("config.get reaches the server and returns 200", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)
    const result = await sdk.config.get()
    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
  })

  test("session 404: result-tuple path returns the error body", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)
    const result = await sdk.session.get({ path: { id: "ses_no_such" } as never })
    expect(result.error).toBeDefined()
    expect(result.error).toMatchObject({ name: "NotFoundError" })
  })
})
