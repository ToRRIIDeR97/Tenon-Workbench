import { describe, expect, test } from "bun:test"
import { Harness } from "@tenon/schema/harness"
import type { PromptInputHarnessController } from "./harness-controls"
import { filterHarnessModels, rememberingHarness, searchableModelCount } from "./harness-choice"

const controller = () => {
  const state = {
    current: Harness.InstanceID.make("codex"),
    model: { id: "gpt-5.5" } as Harness.ModelSelection | undefined,
  }
  const value: PromptInputHarnessController = {
    instances: () => [],
    loading: () => false,
    current: () => state.current,
    select: (id) => {
      state.current = id
      state.model = { id: "default-of-" + id }
    },
    model: {
      current: () => state.model,
      set: (model) => {
        state.model = model
      },
    },
  }
  return { value, state }
}

// AC-4: a pick in any composer becomes the next new thread's harness and model.
describe("rememberingHarness", () => {
  test("remembers a harness switch with the model it landed on", () => {
    const { value, state } = controller()
    const seen: unknown[] = []
    rememberingHarness(value, (choice) => seen.push(choice)).select(Harness.InstanceID.make("claude-code"))
    expect(state.current).toBe(Harness.InstanceID.make("claude-code"))
    expect(seen).toEqual([{ harnessID: "claude-code", model: { id: "default-of-claude-code" } }])
  })

  test("remembers a model or reasoning change on the current harness", () => {
    const { value, state } = controller()
    const seen: unknown[] = []
    rememberingHarness(value, (choice) => seen.push(choice)).model.set({ id: "gpt-5.5", reasoningEffort: "high" })
    expect(state.model).toEqual({ id: "gpt-5.5", reasoningEffort: "high" })
    expect(seen).toEqual([{ harnessID: "codex", model: { id: "gpt-5.5", reasoningEffort: "high" } }])
  })

  test("reads pass straight through", () => {
    const { value } = controller()
    const wrapped = rememberingHarness(value, () => {})
    expect(wrapped.current()).toBe(Harness.InstanceID.make("codex"))
    expect(wrapped.model.current()).toEqual({ id: "gpt-5.5" })
  })
})

// AC-5: the harness model list can be searched by name or id.
describe("filterHarnessModels", () => {
  const models = [
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "claude-opus-5-5", name: "Opus 5.5" },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
  ]

  test("an empty query keeps every model", () => {
    expect(filterHarnessModels(models, "  ")).toEqual(models)
  })

  test("matches the name or the id across separators", () => {
    expect(filterHarnessModels(models, "opus").map((model) => model.id)).toEqual(["claude-opus-5-5"])
    expect(filterHarnessModels(models, "claude opus").map((model) => model.id)).toEqual(["claude-opus-5-5"])
    expect(filterHarnessModels(models, "v4.1").map((model) => model.id)).toEqual(["deepseek-v4.1-flash"])
    expect(filterHarnessModels(models, "zzz")).toEqual([])
  })

  test("the search box appears above 8 models", () => {
    expect(searchableModelCount).toBe(8)
  })
})
