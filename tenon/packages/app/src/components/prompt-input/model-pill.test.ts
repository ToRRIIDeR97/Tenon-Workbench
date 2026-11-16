import { describe, expect, test } from "bun:test"
import { modelPillLabel, pillEffort } from "./model-pill-label"

describe("modelPillLabel", () => {
  test("names the model, then the reasoning and speed it is given", () => {
    expect(modelPillLabel({ model: "Opus 5.5", effort: "high", tier: "Fast" })).toBe("Opus 5.5 · high · Fast")
    expect(modelPillLabel({ model: "deepseek-v4" })).toBe("deepseek-v4")
  })

  test("drops a provider prefix from the model name", () => {
    expect(modelPillLabel({ model: "opencode/Nemotron 3.5 Super VL Free" })).toBe("Nemotron 3.5 Super VL Free")
    expect(modelPillLabel({ model: "anthropic/claude-sonnet-4.5", effort: "high" })).toBe("claude-sonnet-4.5 · high")
    expect(modelPillLabel({ model: "GPT 5 / mini" })).toBe("GPT 5 / mini")
  })
})

describe("pillEffort", () => {
  const offered = { offered: true, defaultLabel: "Default" }

  test("shows the chosen level", () => {
    expect(pillEffort({ ...offered, current: "high" })).toBe("high")
    expect(modelPillLabel({ model: "Default", effort: pillEffort({ ...offered, current: "High" }) })).toBe(
      "Default · High",
    )
  })

  test("on default, shows the level default resolves to, else the word for default", () => {
    expect(pillEffort({ ...offered, current: "", resolved: "medium" })).toBe("medium")
    expect(pillEffort({ ...offered, current: "default", resolved: "low" })).toBe("low")
    expect(pillEffort({ ...offered, current: "" })).toBe("Default")
    expect(pillEffort({ ...offered, current: "default" })).toBe("Default")
    expect(pillEffort({ ...offered })).toBe("Default")
  })

  test("shows nothing when the model offers no levels", () => {
    expect(pillEffort({ offered: false, current: "high", defaultLabel: "Default" })).toBeUndefined()
  })
})
