import { describe, expect, test } from "bun:test"
import { hunkKeys, revertHunk, trackedHunks, trackedRows } from "./tracked-edits"

describe("tracked edits", () => {
  test("CRLF lines round-trip through a revert", () => {
    const before = "# T\r\nOne.\r\nTwo.\r\n"
    const after = "# T\r\nOne, longer.\r\nTwo.\r\n"
    const hunks = trackedHunks(before, after)
    expect(hunks).toEqual([{ start: 1, removed: ["One.\r"], added: ["One, longer.\r"] }])
    expect(revertHunk(after, hunks[0])).toBe(before)
  })

  test("rows put removed lines before added ones, a review row after, and kept changes plain", () => {
    const before = "a\nb\nc\nd"
    const after = "a\nB\nc\nD"
    const hunks = trackedHunks(before, after)
    expect(trackedRows(after, hunks)).toEqual([
      { kind: "same", text: "a", line: 1 },
      { kind: "removed", text: "b", hunk: 0 },
      { kind: "added", text: "B", line: 2, hunk: 0 },
      { kind: "review", hunk: 0 },
      { kind: "same", text: "c", line: 3 },
      { kind: "removed", text: "d", hunk: 1 },
      { kind: "added", text: "D", line: 4, hunk: 1 },
      { kind: "review", hunk: 1 },
    ])
    expect(trackedRows(after, hunks, new Set([0])).slice(0, 3)).toEqual([
      { kind: "same", text: "a", line: 1 },
      { kind: "same", text: "B", line: 2 },
      { kind: "same", text: "c", line: 3 },
    ])
  })

  test("identical changes get their own keys, which hold when a change above is undone", () => {
    const base = "x\na\ny\na\nz"
    const after = "x\nA\ny\nA\nz"
    const hunks = trackedHunks(base, after)
    const keys = hunkKeys(hunks)
    expect(new Set(keys).size).toBe(2)
    const undone = revertHunk(after, hunks[0])
    expect(hunkKeys(trackedHunks(base, undone))).toEqual([keys[1]])
    const grown = "x\nA\nA2\ny\nA\nz"
    const [, second] = hunkKeys(trackedHunks(base, grown))
    expect(second).toBe(keys[1])
  })

  test("a very large change is one hunk", () => {
    const before = Array.from({ length: 3000 }, (_, index) => `old ${index}`).join("\n")
    const after = Array.from({ length: 3000 }, (_, index) => `new ${index}`).join("\n")
    const hunks = trackedHunks(before, after)
    expect(hunks).toHaveLength(1)
    expect(revertHunk(after, hunks[0])).toBe(before)
  })
})
