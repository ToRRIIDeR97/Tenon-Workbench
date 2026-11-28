import { describe, expect } from "bun:test"
import { createTwoFilesPatch } from "diff"
import { mkdtemp, rm, stat, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { TestInstance } from "../fixture/fixture"
import { it, json, request } from "../knowledge/vault-harness"

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  )

describe("AC-27 /file/revert stays inside the folder through links", () => {
  it.instance("a deleted file under a linked folder that points outside is not recreated", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const outside = yield* Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "tenon-revert-outside-")))
      yield* Effect.promise(() =>
        symlink(outside, path.join(test.directory, "link"), process.platform === "win32" ? "junction" : "dir"),
      )
      const response = yield* request("/file/revert", {
        method: "POST",
        headers: { "x-opencode-directory": test.directory, "content-type": "application/json" },
        body: JSON.stringify({
          files: [
            {
              file: "link/new/escaped.txt",
              status: "deleted",
              patch: createTwoFilesPatch("a/x.txt", "b/x.txt", "secret\n", ""),
            },
          ],
        }),
      })
      const body = yield* json(response)
      const escaped = yield* Effect.promise(() => exists(path.join(outside, "new", "escaped.txt")))
      yield* Effect.promise(() => rm(outside, { recursive: true, force: true }))
      expect(body).toEqual([{ file: "link/new/escaped.txt", result: "failed" }])
      expect(escaped).toBe(false)
    }),
  )
})
