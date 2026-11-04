import { afterAll, beforeAll, describe, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { httpClient } from "@tenon/core/effect/app-node-platform"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { Global } from "@tenon/core/global"
import { RipgrepBinary } from "@tenon/core/ripgrep/binary"
import { testEffect } from "./lib/effect"

let requests = 0
const tampered = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) => {
    requests += 1
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not the ripgrep archive")))
  }),
)
const it = testEffect(AppNodeBuilder.build(LayerNode.group([RipgrepBinary.node]), [[httpClient, tampered]]))

describe("RipgrepBinary", () => {
  const original = { path: process.env.PATH, bundled: process.env.TENON_RIPGREP_PATH, bin: Global.Path.bin }

  beforeAll(async () => {
    Global.Path.bin = await fs.mkdtemp(path.join(os.tmpdir(), "ripgrep-binary-"))
    process.env.PATH = Global.Path.bin
    delete process.env.TENON_RIPGREP_PATH
  })

  afterAll(async () => {
    await fs.rm(Global.Path.bin, { recursive: true, force: true })
    Global.Path.bin = original.bin
    process.env.PATH = original.path
    if (original.bundled) process.env.TENON_RIPGREP_PATH = original.bundled
  })

  it.live("rejects bytes that miss the pinned checksum, and tries again on the next search", () =>
    Effect.gen(function* () {
      const binary = yield* RipgrepBinary.Service
      const first = yield* binary.filepath.pipe(Effect.flip)
      expect(first.message).toContain("checksum mismatch")
      yield* binary.filepath.pipe(Effect.flip)
      expect(requests).toBe(2)
      expect(yield* Effect.promise(() => fs.readdir(Global.Path.bin))).toEqual([])
    }),
  )
})
