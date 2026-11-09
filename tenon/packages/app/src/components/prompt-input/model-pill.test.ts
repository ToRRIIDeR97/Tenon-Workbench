import { describe, expect, test } from "bun:test"
import { modelPillLabel } from "./model-pill-label"

describe("modelPillLabel", () => {
  test("names the model, then the reasoning and speed that aren't the default", () => {
    expect(modelPillLabel({ model: "Opus 5.5", effort: "high", tier: "Fast" })).toBe("Opus 5.5 · high · Fast")
    expect(modelPillLabel({ model: "deepseek-v4" })).toBe("deepseek-v4")
  })

  test("drops a provider prefix from the model name", () => {
    expect(modelPillLabel({ model: "opencode/Nemotron 3.5 Super VL Free" })).toBe("Nemotron 3.5 Super VL Free")
    expect(modelPillLabel({ model: "anthropic/claude-sonnet-4.5", effort: "high" })).toBe("claude-sonnet-4.5 · high")
    expect(modelPillLabel({ model: "GPT 5 / mini" })).toBe("GPT 5 / mini")
  })
})
