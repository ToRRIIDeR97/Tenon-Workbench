import { describe, expect, test } from "bun:test"
import { applyTemplate, dailyNotePath, projectTemplate, timelineFromTemplate } from "./templates"

describe("templates (verification)", () => {
  test("AC-10 placeholders repeat and tolerate inner spaces; month and year boundaries roll over", () => {
    const now = new Date(2026, 11, 31, 23, 30)
    expect(applyTemplate("{{ date }} {{date}} {{tomorrow}}", { now, title: "" })).toBe(
      "2026-12-31 2026-12-31 2027-01-01",
    )
    expect(applyTemplate("{{yesterday}}", { now: new Date(2026, 2, 1), title: "" })).toBe("2026-02-28")
  })

  test("AC-10 a template without placeholders is unchanged", () => {
    expect(applyTemplate("plain", { now: new Date(), title: "T" })).toBe("plain")
  })

  test("AC-12 single-digit months and days are padded", () => {
    expect(dailyNotePath(new Date(2026, 0, 5))).toBe("Daily/2026-01-05.md")
  })

  test("AC-13 milestones become timeline items spaced from the start date", () => {
    const items = timelineFromTemplate(projectTemplate("launch")!, new Date(2026, 10, 2), () => "id")
    expect(items.length).toBe(projectTemplate("launch")!.milestones.length)
    expect(items.every((item) => item.kind === "milestone" && item.status === "todo")).toBe(true)
    const starts = items.map((item) => item.start!)
    expect([...starts].sort()).toEqual(starts)
    expect(starts[0]! >= "2026-11-02").toBe(true)
  })
})
