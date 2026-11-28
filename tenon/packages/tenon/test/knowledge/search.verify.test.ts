import { describe, expect, test } from "bun:test"
import { KnowledgeSearch } from "../../src/knowledge/search"

const base = { source: "local" as const, syncState: "local" as const }

describe("AC-18 calendar search (verification)", () => {
  test("items waiting to be deleted are not results", () => {
    const snapshot = {
      events: [{ ...base, id: "e1", title: "deploy", date: "2026-11-30", outboxKind: "delete" as const }],
      tasks: [
        {
          ...base,
          id: "t1",
          title: "deploy",
          outboxKind: "delete" as const,
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    }
    expect(KnowledgeSearch.calendar(snapshot, "deploy", 8)).toEqual({ events: [], tasks: [] })
  })

  test("a result carries what the app needs to open it", () => {
    const snapshot = {
      events: [{ ...base, id: "e1", title: "Deploy", date: "2026-11-30", start: "10:00" }],
      tasks: [],
    }
    expect(KnowledgeSearch.calendar(snapshot, "dep", 8).events[0]).toMatchObject({
      id: "e1",
      title: "Deploy",
      date: "2026-11-30",
    })
  })
})
