import { afterAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { downloadModel } from "./dictation-download"
import { DICTATION_MODELS, type DictationModel } from "./dictation-models"

const bytes = Buffer.from("the whole speech model")
const model = {
  ...DICTATION_MODELS[0],
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
} as unknown as DictationModel
const folder = await mkdtemp(join(tmpdir(), "dictation-download-"))
afterAll(() => rm(folder, { recursive: true, force: true }))

const run = (name: string, fetch: (url: string, init: RequestInit) => Promise<Response>, signal?: AbortSignal) =>
  downloadModel({
    model,
    target: join(folder, name),
    fetch,
    signal: signal ?? new AbortController().signal,
    onProgress: () => {},
  })

test("resumes a partial file with a Range request and hashes the bytes already there", async () => {
  await writeFile(join(folder, "resume.part"), bytes.subarray(0, 9))
  let range: string | null = null
  await run("resume", async (_url, init) => {
    range = new Headers(init.headers).get("range")
    return new Response(bytes.subarray(9), {
      status: 206,
      headers: { "content-range": `bytes 9-${bytes.length - 1}/${bytes.length}` },
    })
  })
  expect(range).toBe("bytes=9-")
  expect(await readFile(join(folder, "resume"))).toEqual(bytes)
})

test("a server that ignores the Range restarts the file", async () => {
  await writeFile(join(folder, "restart.part"), "stale")
  await run("restart", async () => new Response(bytes))
  expect(await readFile(join(folder, "restart"))).toEqual(bytes)
})

test("a dropped connection keeps the partial file; a cancel removes it", async () => {
  await expect(run("drop", async () => new Response(bytes.subarray(0, 5)))).rejects.toMatchObject({ code: "network" })
  expect(existsSync(join(folder, "drop.part"))).toBe(true)

  const cancel = new AbortController()
  const stalled = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 5))
      setTimeout(() => cancel.abort(), 20)
    },
  })
  await expect(run("cancel", async () => new Response(stalled), cancel.signal)).rejects.toMatchObject({
    code: "cancelled",
  })
  expect(existsSync(join(folder, "cancel.part"))).toBe(false)
})

test("bytes that miss the checksum are removed", async () => {
  await expect(run("bad", async () => new Response("x".repeat(bytes.length)))).rejects.toMatchObject({
    code: "checksum",
  })
  expect(existsSync(join(folder, "bad.part"))).toBe(false)
})
