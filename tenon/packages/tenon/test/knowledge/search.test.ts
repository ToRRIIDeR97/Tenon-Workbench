import { describe, expect, test } from "bun:test"
import { KnowledgeSearch } from "../../src/knowledge/search"

const base = { source: "local" as const, syncState: "local" as const }

describe("AC-18 calendar search", () => {
  test("matches task title and notes, event title and details, with snippets and a limit", () => {
    const snapshot = {
      events: [
        { ...base, id: "e1", title: "Deploy review", date: "2026-11-30" },
        { ...base, id: "e2", title: "Lunch", date: "2026-11-30", details: "talk about the deploy" },
        { ...base, id: "e3", title: "Gym", date: "2026-11-30" },
      ],
      tasks: [
        {
          ...base,
          id: "t1",
          title: "Write deploy notes",
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
        {
          ...base,
          id: "t2",
          title: "Other",
          notes: "DEPLOY on Friday",
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    }
    const result = KnowledgeSearch.calendar(snapshot, "deploy", 8)
    expect(result.events.map((item) => item.id)).toEqual(["e1", "e2"])
    expect(result.tasks.map((item) => item.id)).toEqual(["t1", "t2"])
    expect(result.tasks[1]?.snippet).toContain("DEPLOY")
    expect(KnowledgeSearch.calendar(snapshot, "deploy", 1).events.length).toBe(1)
  })

  test("a query under two characters is empty", () => {
    expect(KnowledgeSearch.validQuery(" d ")).toBe(false)
    expect(KnowledgeSearch.validQuery("de")).toBe(true)
  })
})
