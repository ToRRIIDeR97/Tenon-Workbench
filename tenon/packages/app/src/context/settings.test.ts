import { describe, expect, test } from "bun:test"
import {
  hasExistingWebState,
  initialAgentVisibility,
  modelProvider,
  newThreadChoice,
  withVisibleModels,
} from "./settings"

describe("agent visibility", () => {
  test("shows the picker for existing profiles and hides it for first-time installs", () => {
    expect(initialAgentVisibility(undefined, true)).toBe(true)
    expect(initialAgentVisibility(undefined, false)).toBe(false)
  })

  test("shows the picker when updating from a recent release", () => {
    expect(initialAgentVisibility(undefined, false, "1.18.8")).toBe(true)
  })

  test("preserves the preference after initialization", () => {
    expect(initialAgentVisibility(true, true, "1.18.8")).toBeUndefined()
    expect(initialAgentVisibility(true, false)).toBeUndefined()
  })
})

describe("web profile classification", () => {
  test("classifies web profiles from existing settings or a recorded version", () => {
    expect(hasExistingWebState("{}", undefined)).toBe(true)
    expect(hasExistingWebState(null, "1.17.19")).toBe(true)
    expect(hasExistingWebState(null, undefined)).toBe(false)
  })
})

describe("harness model visibility", () => {
  test("leaves out hidden models and keeps new ones visible", () => {
    const instance = { id: "codex", models: [{ id: "a" }, { id: "b" }, { id: "new" }] }
    expect(withVisibleModels(instance, ["b"]).models.map((model) => model.id)).toEqual(["a", "new"])
    expect(withVisibleModels(instance, undefined)).toBe(instance)
  })

  test("leaves out every model of a hidden provider, including ones added later", () => {
    const instance = {
      id: "opencode-acp",
      models: [{ id: "anthropic/claude" }, { id: "openrouter/openai/gpt" }, { id: "openrouter/new" }, { id: "plain" }],
    }
    expect(withVisibleModels(instance, [], ["openrouter"]).models.map((model) => model.id)).toEqual([
      "anthropic/claude",
      "plain",
    ])
    expect(modelProvider("openrouter/openai/gpt")).toBe("openrouter")
    expect(modelProvider("plain")).toBeUndefined()
  })
})

describe("newThreadChoice", () => {
  const lastUsed = { harnessID: "opencode-acp", model: { id: "nemotron" } }
  const fixed = { mode: "fixed" as const, harnessID: "codex" }

  test("starts from the last harness used until a default is saved", () => {
    expect(newThreadChoice(undefined)).toBeUndefined()
    expect(newThreadChoice({ lastUsed })).toEqual(lastUsed)
  })

  test("follows the saved default", () => {
    expect(newThreadChoice({ defaults: fixed, lastUsed })).toEqual(fixed)
    expect(newThreadChoice({ defaults: { ...fixed, mode: "last" }, lastUsed })).toEqual(lastUsed)
    const last = { ...fixed, mode: "last" as const }
    expect(newThreadChoice({ defaults: last })).toEqual(last)
  })
})
