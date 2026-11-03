import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { sectionFromTab } from "../../../../tenon/packages/app/src/features/second-brain/project-view"
import { dayLabel, monthDays } from "../../../../tenon/packages/app/src/features/second-brain/project-controls"

const src = path.resolve(import.meta.dir, "../../../../tenon/packages/app/src")
const read = (file: string) => readFileSync(path.join(src, file), "utf8")
const projectFiles = [
  "pages/projects.tsx",
  "features/second-brain/project-view.tsx",
  "features/second-brain/project-controls.tsx",
  "features/second-brain/project-details.tsx",
]

describe("AC-2 one page, no tree", () => {
  test("AC-2 the page tree and the tabbed Project view are gone", () => {
    expect(existsSync(path.join(src, "features/second-brain/notes-tree.tsx"))).toBe(false)
    expect(existsSync(path.join(src, "features/second-brain/notes-project.tsx"))).toBe(false)
    expect(read("pages/projects.tsx")).toContain("<ProjectView")
    expect(read("features/second-brain/project-view.tsx")).not.toContain("TabsV2")
  })
})

describe("AC-7 app-styled controls", () => {
  test("AC-7 the Projects page renders no native select or date input", () => {
    for (const file of projectFiles) {
      // Comments may name the native controls they replace.
      const source = read(file)
        .split("\n")
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join("\n")
      expect(`${file}: ${source.includes("<select")}`).toBe(`${file}: false`)
      expect(`${file}: ${/type="date"/.test(source)}`).toBe(`${file}: false`)
    }
  })

  test("AC-7 the month grid starts on Monday and pads the first week", () => {
    // 1 Nov 2026 is a Sunday: six empty cells, then the 1st.
    const days = monthDays("2026-11")
    expect(days.slice(0, 6)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
    expect(days[6]).toBe("2026-11-01")
    expect(days.at(-1)).toBe("2026-11-30")
    expect(days.length).toBe(36)
  })

  test("AC-7 a date chip reads like a day and ignores values that aren't days", () => {
    expect(dayLabel("2026-11-13", "en-US")).toBe("Fri, Nov 13")
    expect(dayLabel("not a day", "en-US")).toBe("")
    expect(dayLabel(undefined, "en-US")).toBe("")
  })
})

describe("AC-8 older links", () => {
  test("AC-8 every old tab maps to its section", () => {
    expect(["timeline", "board", "table", "calendar"].map(sectionFromTab)).toEqual(["tasks", "tasks", "tasks", "tasks"])
    expect(sectionFromTab("docs")).toBe("pages")
    expect(sectionFromTab("log")).toBe("log")
    expect(sectionFromTab("details")).toBe("settings")
    expect(sectionFromTab("threads")).toBe("threads")
    expect(sectionFromTab("nonsense")).toBeUndefined()
    expect(sectionFromTab(undefined)).toBeUndefined()
  })

  test("AC-8 agent-write Open links use section=", () => {
    expect(read("features/agent-writes/store.tsx")).toContain("&section=log")
  })
})
