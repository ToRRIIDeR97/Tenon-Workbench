import { describe, expect, test } from "bun:test"
import {
  appendProfileRule,
  parseProfileMarkdown,
  profileDue,
  profileFor,
  profileInstruction,
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
})
