import { describe, expect, test } from "bun:test"
import {
  appendProfileRule,
  parseProfileMarkdown,
  profileDue,
  profileFor,
  profileInstruction,
  profileModelMatches,
  profileRules,
  removeProfileRule,
} from "./model-profile"

describe("model profiles", () => {
  test("profile.md front matter names the model; without it the picked name is used", () => {
    expect(parseProfileMarkdown("---\nmodel: deepseek-v4.1-flash\n---\n- Run tests\n")).toEqual({
      model: "deepseek-v4.1-flash",
      rules: "- Run tests",
    })
    expect(parseProfileMarkdown("- Read before editing", "glm-5.3")).toEqual({
      model: "glm-5.3",
      rules: "- Read before editing",
    })
  })

  test("a profile matches the full id or the model part, only when switched on", () => {
    const profiles = {
      "deepseek-v4.1-flash": { rules: "- Run tests", enabled: true, updatedAt: 1 },
      "glm-5.3": { rules: "- x", enabled: false, updatedAt: 1 },
    }
    expect(profileFor(profiles, "opencode-go/deepseek-v4.1-flash")).toEqual({
      model: "deepseek-v4.1-flash",
      rules: "- Run tests",
    })
    expect(profileFor(profiles, "deepseek-v4.1-flash")?.model).toBe("deepseek-v4.1-flash")
    expect(profileFor(profiles, "zai/glm-5.3")).toBeUndefined()
    expect(profileFor(profiles, "gpt-5.5")).toBeUndefined()
  })

  test("the profile is sent on a new thread and when the model changes", () => {
    expect(profileDue({ newThread: true, model: "a" })).toBe(true)
    expect(profileDue({ newThread: false, previousModel: "a", model: "a" })).toBe(false)
    expect(profileDue({ newThread: false, previousModel: "a", model: "b" })).toBe(true)
    expect(profileInstruction("a", "- x")).toContain('<model-profile model="a">')
  })

  test("the Rules view lists each rule line without its bullet, skipping blanks and headings", () => {
    const rules = [
      "# Notes",
      "- Run the tests.",
      "",
      "* Quote the error.",
      "2. Keep imports sorted.",
      "Plain line",
    ].join("\n")
    expect(profileRules(rules)).toEqual([
      { index: 1, text: "Run the tests." },
      { index: 3, text: "Quote the error." },
      { index: 4, text: "Keep imports sorted." },
      { index: 5, text: "Plain line" },
    ])
  })

  test("rules are removed by line and appended as bullets", () => {
    expect(removeProfileRule("- a\n- b\n- c", 1)).toBe("- a\n- c")
    expect(appendProfileRule("- a\n", " b ")).toBe("- a\n- b")
    expect(appendProfileRule("", "first")).toBe("- first")
    expect(appendProfileRule("- a", "  ")).toBe("- a")
  })

  test("Add profile searches models by name, id or provider, leaving out ones that have a profile", () => {
    const provider = (id: string, name: string) => ({ id, name })
    const models = [
      { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", provider: provider("opencode", "OpenCode Zen") },
      { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", provider: provider("deepseek", "DeepSeek") },
      { id: "kimi-k2.5", name: "Kimi K2.5", provider: provider("moonshot", "Moonshot") },
      { id: "qwen3-coder", name: "Qwen 3 Coder", provider: provider("opencode", "OpenCode Zen") },
    ]
    const ids = (query: string, existing: string[] = []) =>
      profileModelMatches(models, query, existing).map((model) => `${model.provider.id}/${model.id}`)
    expect(ids("deep")).toEqual(["opencode/deepseek-v4.1-flash"])
    expect(ids("zen")).toEqual(["opencode/deepseek-v4.1-flash", "opencode/qwen3-coder"])
    expect(ids("", ["kimi-k2.5", "opencode/qwen3-coder"])).toEqual(["opencode/deepseek-v4.1-flash"])
    expect(ids("qwen")).toEqual(["opencode/qwen3-coder"])
  })
})
