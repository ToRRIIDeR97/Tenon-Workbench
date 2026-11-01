import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const directoryFor = async (headers: Record<string, string>) => {
  const response = await Server.Default().app.request("/path", { headers })
  expect(response.status).toBe(200)
  return ((await response.json()) as { directory: string }).directory
}

describe("directory header names", () => {
  test("x-tenon-directory routes the request", async () => {
    await using tmp = await tmpdir()
    expect(await directoryFor({ "x-tenon-directory": tmp.path })).toBe(tmp.path)
  })

  test("the OpenCode protocol name still works", async () => {
    await using tmp = await tmpdir()
    expect(await directoryFor({ "x-opencode-directory": tmp.path })).toBe(tmp.path)
  })
})
