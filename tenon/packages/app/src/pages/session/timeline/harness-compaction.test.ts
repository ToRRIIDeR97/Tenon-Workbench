import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { observedCompactions } from "./harness-compaction"

const reply = (id: string, parentID: string, contextUsed?: number, harnessInstanceID = "claude-code") =>
  ({ id, parentID, role: "assistant", harnessInstanceID, contextUsed }) as never

describe("AC-18 a harness's compaction shows from its context reports", () => {
  test("a sharp drop between two turns on the same harness marks the later turn", () => {
    const found = observedCompactions([
      reply("a1", "u1", 150_000),
      reply("a2", "u2", 182_000),
      reply("a3", "u3", 41_000),
    ])
    expect([...found.entries()]).toEqual([["u3", { harness: "claude-code", before: 182_000, after: 41_000 }]])
  })

  test("growth, small dips and early small contexts are not compactions", () => {
    expect(observedCompactions([reply("a1", "u1", 40_000), reply("a2", "u2", 60_000)]).size).toBe(0)
    expect(observedCompactions([reply("a1", "u1", 100_000), reply("a2", "u2", 90_000)]).size).toBe(0)
    expect(observedCompactions([reply("a1", "u1", 15_000), reply("a2", "u2", 2_000)]).size).toBe(0)
  })

  test("only the same harness is compared, and messages without a report are skipped", () => {
    const found = observedCompactions([
      reply("a1", "u1", 180_000, "claude-code"),
      reply("a2", "u2", 30_000, "codex"),
      reply("a3", "u3", undefined, "claude-code"),
      reply("a4", "u4", 170_000, "claude-code"),
    ])
    expect(found.size).toBe(0)
  })

  test("Tenon's own agent is left to its own compaction divider", () => {
    expect(
      observedCompactions([reply("a1", "u1", 180_000, "opencode"), reply("a2", "u2", 20_000, "opencode")]).size,
    ).toBe(0)
  })

  test("the timeline renders the observed divider", () => {
    const source = readFileSync(join(import.meta.dir, "message-timeline.tsx"), "utf8")
    expect(source).toContain('"harness-compaction"')
    expect(source).toContain("secondBrain.timeline.harnessCompaction")
  })
})
