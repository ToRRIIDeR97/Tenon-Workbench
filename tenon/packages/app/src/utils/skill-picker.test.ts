import { describe, expect, test } from "bun:test"
import { pickerSkills } from "./skill-reference"

// AC-2: one entry per skill name in the "/" picker, Tenon's own first.
describe("pickerSkills", () => {
  const catalog = {
    tenon: [
      { name: "review", enabled: true },
      { name: "off", enabled: false },
      { name: "review", enabled: true },
    ],
    harnesses: [
      {
        id: "opencode-acp",
        skills: [{ name: "deep" }, { name: "deep" }, { name: "review" }, { name: "local" }],
      },
      { id: "codex", skills: [{ name: "other" }] },
    ],
  }

  test("dedupes within Tenon's list and within a harness's list", () => {
    expect(pickerSkills(catalog, "opencode-acp").map((skill) => skill.name)).toEqual(["review", "deep", "local"])
  })

  test("leaves out switched-off Tenon skills and other harnesses' skills", () => {
    expect(pickerSkills(catalog, "codex").map((skill) => skill.name)).toEqual(["review", "other"])
    expect(pickerSkills(catalog, undefined).map((skill) => skill.name)).toEqual(["review"])
  })
})
