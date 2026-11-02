import { describe, expect, test } from "bun:test"
import { modelPillLabel } from "./model-pill-label"

describe("modelPillLabel", () => {
  test("names the model, then the reasoning and speed that aren't the default", () => {
    expect(modelPillLabel({ model: "Opus 5.5", effort: "high", tier: "Fast" })).toBe("Opus 5.5 · high · Fast")
    expect(modelPillLabel({ model: "deepseek-v4" })).toBe("deepseek-v4")
  })
})
