import { describe, expect, test } from "bun:test"
import { alsoIn, filterSections, skillSections } from "./skills-sections"

const sections = skillSections({
  tenon: [{ name: "review", description: "Review a diff", scope: "global" }],
  harnesses: [
    {
      id: "claude",
      name: "Claude Code",
      source: "filesystem",
      skills: [
        { name: "review", scope: "global" },
        { name: "simplify", description: "Clean up changed code", scope: "project" },
      ],
    },
    { id: "codex", name: "Codex", source: "none", skills: [] },
  ],
})

describe("skills filtering", () => {
  test("search keeps skills holding every word and drops sections left empty", () => {
    expect(
      filterSections(sections, "clean code", "all").map((item) => [item.id, item.skills.map((s) => s.name)]),
    ).toEqual([["claude", ["simplify"]]])
  })

  test("a chosen section shows only itself, empty or not", () => {
    expect(filterSections(sections, "", "codex").map((item) => item.id)).toEqual(["codex"])
    expect(filterSections(sections, "", "all")).toHaveLength(3)
  })

  test("also in lists the other sections that have the same skill", () => {
    const other = alsoIn(sections)
    expect(other("Tenon", "review")).toEqual(["Claude Code"])
    expect(other("Claude Code", "simplify")).toEqual([])
  })
})
