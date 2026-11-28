import { describe, expect, test } from "bun:test"
import {
  applyTemplate,
  dailyNotePath,
  isTemplatePath,
  PROJECT_TEMPLATES,
  projectTemplate,
  templateName,
} from "./templates"

const now = new Date(2026, 10, 28, 9, 5)

describe("AC-10 applyTemplate", () => {
  test("replaces the known placeholders with local date and time", () => {
    expect(
      applyTemplate("# {{title}}\n{{date}} {{time}} {{weekday}}\n< {{yesterday}} > {{tomorrow}}", {
        now,
        title: "Standup",
      }),
    ).toBe("# Standup\n2026-11-28 09:05 Saturday\n< 2026-11-27 > 2026-11-29")
  })

  test("unknown placeholders stay as written", () => {
    expect(applyTemplate("{{owner}} {{title}}", { now, title: "X" })).toBe("{{owner}} X")
  })
})

describe("AC-11 template pages", () => {
  test("pages under Templates/ are templates, named by file name", () => {
    expect(isTemplatePath("Templates/Meeting.md")).toBe(true)
    expect(isTemplatePath("templates/Meeting.md")).toBe(true)
    expect(isTemplatePath("Notes/Templates.md")).toBe(false)
    expect(templateName("Templates/Meeting notes.md")).toBe("Meeting notes")
  })
})

describe("AC-12 dailyNotePath", () => {
  test("is Daily/YYYY-MM-DD.md for the local date", () => {
    expect(dailyNotePath(now)).toBe("Daily/2026-11-28.md")
    expect(dailyNotePath(new Date(2027, 0, 3, 23, 59))).toBe("Daily/2027-01-03.md")
  })
})

describe("AC-13 project templates", () => {
  test("offers blank, software, research, writing and launch", () => {
    expect(PROJECT_TEMPLATES.map((item) => item.id)).toEqual(["blank", "software", "research", "writing", "launch"])
  })

  test("blank adds nothing; others bring milestones and a starter page", () => {
    expect(projectTemplate("blank")).toMatchObject({ milestones: [], page: undefined })
    const software = projectTemplate("software")!
    expect(software.milestones.length).toBeGreaterThan(0)
    expect(software.page?.title).toBeTruthy()
    expect(projectTemplate("nope")).toBeUndefined()
  })
})
