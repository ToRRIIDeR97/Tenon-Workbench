import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadModelsData } from "../script/models-snapshot"

const dir = await mkdtemp(join(tmpdir(), "tenon-models-snapshot-"))
const snapshot = join(dir, "dist", "snapshot.json")
let respond = () => Response.json({ first: true })
const server = Bun.serve({ port: 0, fetch: () => respond() })
const url = server.url.href

afterAll(async () => {
  server.stop(true)
  await rm(dir, { recursive: true, force: true })
})

test("a failed download with no snapshot stops the build with a clear error", async () => {
  respond = () => new Response("down", { status: 503 })
  await expect(loadModelsData({ url, snapshot })).rejects.toThrow("no snapshot exists")
})

test("a good download is saved, and an error or non-JSON body falls back to it", async () => {
  respond = () => Response.json({ first: true })
  expect(await loadModelsData({ url, snapshot })).toBe('{"first":true}')

  respond = () => new Response("Bad gateway", { status: 502 })
  expect(await loadModelsData({ url, snapshot })).toBe('{"first":true}')

  respond = () => new Response("<html>not json</html>")
  expect(await loadModelsData({ url, snapshot })).toBe('{"first":true}')
})
