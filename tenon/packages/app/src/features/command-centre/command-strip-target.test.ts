import { describe, expect, test } from "bun:test"
import { Harness } from "@tenon/schema/harness"
import { promptRoute, stripTarget } from "./command-strip-target"

// #329: the Command Centre card can pick the thread it replies to, and what a send runs on is the pill's choice for
// a new thread and the thread's own harness for a reply.
const threads = [{ id: "ses_new" }, { id: "ses_mid" }, { id: "ses_old" }]

describe("stripTarget", () => {
  test("AC-7 the newest thread by default", () => {
    expect(stripTarget(undefined, threads, "ses_new")).toBe("ses_new")
  })

  test("AC-7 the chosen thread while it still exists", () => {
    expect(stripTarget("ses_old", threads, "ses_new")).toBe("ses_old")
  })

  test("AC-7 a chosen thread that's gone falls back to the newest", () => {
    expect(stripTarget("ses_archived", threads, "ses_new")).toBe("ses_new")
  })

  test("AC-7 New thread targets none", () => {
    expect(stripTarget(null, threads, "ses_new")).toBeNull()
    expect(stripTarget(undefined, [], undefined)).toBeNull()
  })
})

describe("promptRoute", () => {
  const claude = Harness.InstanceID.make("claude-code")
  const defaults = { harnessID: Harness.OpenCode, model: { providerID: "anthropic", modelID: "claude-opus-5-5" } }
  const builtInChoice = {
    harnessID: Harness.OpenCode,
    model: { providerID: "openai", modelID: "gpt-5.5", variant: "high" },
  }

  test("AC-8 a new thread runs on the pill's harness", () => {
    expect(promptRoute({ choice: { harnessID: claude, harnessModel: { id: "opus" } }, defaults })).toEqual({
      harnessID: claude,
      harness: true,
    })
  })

  test("AC-8 a new built-in thread takes the pill's model", () => {
    expect(promptRoute({ choice: builtInChoice, defaults })).toEqual({
      harnessID: Harness.OpenCode,
      harness: false,
      model: builtInChoice.model,
    })
  })

  test("AC-8 without a pick, Settings decides", () => {
    expect(promptRoute({ defaults })).toEqual({ harnessID: Harness.OpenCode, harness: false, model: defaults.model })
  })

  test("AC-8 a reply keeps its thread's harness whatever the pill shows", () => {
    expect(promptRoute({ choice: builtInChoice, defaults, thread: { harnessID: claude } })).toEqual({
      harnessID: claude,
      harness: true,
    })
    // A built-in thread with the pill on another harness: the prompt stays built-in, on the Settings model.
    expect(
      promptRoute({ choice: { harnessID: claude }, defaults, thread: { harnessID: Harness.OpenCode } }),
    ).toEqual({ harnessID: Harness.OpenCode, harness: false, model: defaults.model })
    // A built-in thread with the pill on the built-in agent: the pill's model.
    expect(promptRoute({ choice: builtInChoice, defaults, thread: { harnessID: Harness.OpenCode } })).toEqual({
      harnessID: Harness.OpenCode,
      harness: false,
      model: builtInChoice.model,
    })
  })
})
