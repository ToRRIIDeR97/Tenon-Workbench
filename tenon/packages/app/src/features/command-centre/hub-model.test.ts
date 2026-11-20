import { describe, expect, test } from "bun:test"
import { sessionHarness } from "./hub-model"

describe("sessionHarness", () => {
  test("reads normalized fields first, then the legacy metadata", () => {
    expect(sessionHarness({ harnessInstanceID: "codex", harnessModel: { id: "gpt-5.5" } }, "opencode")).toEqual({
      harness: "codex",
      model: { id: "gpt-5.5" },
    })
    expect(
      sessionHarness(
        { metadata: { harnessInstanceID: "opencode-acp", harnessModel: { id: "x/flash", reasoningEffort: "max" } } },
        "opencode",
      ),
    ).toEqual({ harness: "opencode-acp", model: { id: "x/flash", reasoningEffort: "max" } })
  })

  test("falls back when nothing names a harness, and drops malformed models", () => {
    expect(sessionHarness({ metadata: { harnessModel: { name: "no id" } } }, "opencode")).toEqual({
      harness: "opencode",
    })
    expect(sessionHarness(undefined, "opencode")).toEqual({ harness: "opencode" })
  })
})
