import { describe, expect, test } from "bun:test"
import { createTwoFilesPatch } from "diff"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { FileRevert } from "../../src/file/revert"
import { TestInstance } from "../fixture/fixture"
import { it, json, request } from "../knowledge/vault-harness"

const patch = (before: string, after: string) => createTwoFilesPatch("a/x.txt", "b/x.txt", before, after)

describe("AC-26 revertFileChange (verification)", () => {
  test("an unrelated later edit elsewhere in the file is kept", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") + "\n"
    const after = before.replace("line 2\n", "LINE 2\n")
    const current = after.replace("line 17\n", "line seventeen\n")
    expect(FileRevert.revertFileChange({ status: "modified", patch: patch(before, after), current })).toEqual({
      kind: "write",
      content: before.replace("line 17\n", "line seventeen\n"),
    })
  })

  test("a modified file that no longer exists is changed; a deleted file that came back is changed", () => {
    expect(FileRevert.revertFileChange({ status: "modified", patch: patch("a\n", "b\n"), current: undefined })).toEqual(
      {
        kind: "changed",
      },
    )
    expect(FileRevert.revertFileChange({ status: "deleted", patch: patch("a\n", ""), current: "a\n" })).toEqual({
      kind: "changed",
    })
  })

  test("an added file that is already gone needs nothing", () => {
    expect(FileRevert.revertFileChange({ status: "added", patch: patch("", "x\n"), current: undefined })).toEqual({
      kind: "none",
    })
  })

  test("a patch that cannot be read is changed, never applied", () => {
    expect(FileRevert.revertFileChange({ status: "modified", patch: "not a patch", current: "x" })).toEqual({
      kind: "changed",
    })
  })
})

describe("AC-27 /file/revert (verification)", () => {
  it.instance("reverts inside the folder and never touches a path outside it", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      const file = path.join(test.directory, "notes.txt")
      yield* Effect.promise(() => writeFile(file, "one\nTWO\n"))
      const results = yield* request("/file/revert", {
        method: "POST",
        headers,
        body: JSON.stringify({
          files: [
            { file: "notes.txt", status: "modified", patch: patch("one\ntwo\n", "one\nTWO\n") },
            { file: "../outside.txt", status: "added", patch: patch("", "x\n") },
          ],
        }),
      }).pipe(Effect.flatMap(json<ReadonlyArray<{ file: string; result: string }>>))
      expect(results).toEqual([
        { file: "notes.txt", result: "reverted" },
        { file: "../outside.txt", result: "failed" },
      ])
      expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe("one\ntwo\n")
    }),
  )
})
