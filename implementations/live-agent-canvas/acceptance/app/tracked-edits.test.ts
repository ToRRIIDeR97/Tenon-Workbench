import { describe, expect, test } from "bun:test"
import { contentHash, revertHunk, trackedHunks } from "../../../../tenon/packages/app/src/pages/session/tracked-edits"

const before = ["# Plan", "", "## Risks", "", "Long writes can flood the bus.", "Keep the cap.", "", "## Done", "", "Fast."].join("\n")
const after = [
  "# Plan",
  "",
  "## Risks",
  "",
  "Long writes can flood the bus, which holds 256 events.",
  "Coalesce deltas per call.",
  "Keep the cap.",
  "",
  "## Done",
  "",
  "Fast, and edits show live.",
].join("\n")

describe("AC-20 trackedHunks", () => {
  test("two hunks", () => {
    expect(trackedHunks(before, after)).toEqual([
      {
        start: 4,
        removed: ["Long writes can flood the bus."],
        added: ["Long writes can flood the bus, which holds 256 events.", "Coalesce deltas per call."],
      },
      { start: 10, removed: ["Fast."], added: ["Fast, and edits show live."] },
    ])
  })
  test("no change, no hunks", () => expect(trackedHunks(before, before)).toEqual([]))
})

describe("AC-21 revertHunk", () => {
  test("one hunk", () => {
    const [first] = trackedHunks(before, after)
    const result = revertHunk(after, first)
    expect(result).toContain("Long writes can flood the bus.\nKeep the cap.")
    expect(result).toContain("Fast, and edits show live.")
  })
  test("all hunks, last first", () => {
    const hunks = trackedHunks(before, after)
    expect(hunks.reduceRight((text, hunk) => revertHunk(text, hunk), after)).toBe(before)
  })
})

describe("AC-22 contentHash", () => {
  test("known vector", async () => {
    expect(await contentHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })
})
