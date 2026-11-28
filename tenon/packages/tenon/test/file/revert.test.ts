import { describe, expect, test } from "bun:test"
import { createTwoFilesPatch } from "diff"
import { readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { FileRevert } from "../../src/file/revert"
import { TestInstance } from "../fixture/fixture"
import { it, json, request } from "../knowledge/vault-harness"

const patch = (before: string, after: string) => createTwoFilesPatch("a/x.txt", "b/x.txt", before, after)

describe("AC-26 revertFileChange", () => {
  test("a modified file goes back to its pre-image", () => {
    const before = "one\ntwo\nthree\n"
    const after = "one\nTWO\nthree\n"
    expect(FileRevert.revertFileChange({ status: "modified", patch: patch(before, after), current: after })).toEqual({
      kind: "write",
      content: before,
    })
  })

  test("a modified file whose changed lines were edited again is reported as changed", () => {
    const before = "one\ntwo\nthree\n"
    const after = "one\nTWO\nthree\n"
    expect(
      FileRevert.revertFileChange({ status: "modified", patch: patch(before, after), current: "one\nzwei\nthree\n" }),
    ).toEqual({ kind: "changed" })
  })

  test("an added file is removed when it still holds what the turn wrote", () => {
    expect(FileRevert.revertFileChange({ status: "added", patch: patch("", "new\n"), current: "new\n" })).toEqual({
      kind: "remove",
    })
    expect(FileRevert.revertFileChange({ status: "added", patch: patch("", "new\n"), current: "edited\n" })).toEqual({
      kind: "changed",
    })
  })

  test("a deleted file is created again with its pre-image", () => {
    expect(FileRevert.revertFileChange({ status: "deleted", patch: patch("gone\n", ""), current: undefined })).toEqual({
      kind: "create",
      content: "gone\n",
    })
  })
})

describe("AC-27 /file/revert", () => {
  it.instance("removes a file the turn added and recreates one it deleted", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      yield* Effect.promise(() => writeFile(path.join(test.directory, "added.txt"), "new\n"))
      const results = yield* request("/file/revert", {
        method: "POST",
        headers,
        body: JSON.stringify({
          files: [
            { file: "added.txt", status: "added", patch: patch("", "new\n") },
            { file: "sub/deleted.txt", status: "deleted", patch: patch("old\n", "") },
          ],
        }),
      }).pipe(Effect.flatMap(json<ReadonlyArray<{ file: string; result: string }>>))
      expect(results).toEqual([
        { file: "added.txt", result: "reverted" },
        { file: "sub/deleted.txt", result: "reverted" },
      ])
      expect(
        yield* Effect.promise(() =>
          stat(path.join(test.directory, "added.txt")).then(
            () => true,
            () => false,
          ),
        ),
      ).toBe(false)
      expect(yield* Effect.promise(() => readFile(path.join(test.directory, "sub/deleted.txt"), "utf8"))).toBe("old\n")
    }),
  )
})
