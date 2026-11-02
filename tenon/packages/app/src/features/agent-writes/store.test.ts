import { describe, expect, test } from "bun:test"
import { openHref, parseAgentWrite, sessionFromPath } from "./store"

describe("agent writes", () => {
  test("parses agent.write events and ignores anything else", () => {
    const write = parseAgentWrite("/w/projects/Acme", {
      type: "agent.write",
      properties: {
        id: "w1",
        sessionID: "ses_1",
        kind: "note",
        phase: "done",
        target: "Acme",
        preview: { title: "Plan", text: "x" },
        undo: "undo_1",
        open: { page: "Acme/Plan.md", other: 1 },
      },
    })
    expect(write).toMatchObject({
      id: "w1",
      kind: "note",
      phase: "done",
      undo: "undo_1",
      open: { page: "Acme/Plan.md" },
    })
    expect(
      parseAgentWrite("/w", {
        type: "agent.write",
        properties: { id: "w", sessionID: "s", kind: "sms", phase: "done" },
      }),
    ).toBeUndefined()
    expect(parseAgentWrite("/w", { type: "session.idle", properties: {} })).toBeUndefined()
  })

  test("opens the written page, Project or calendar", () => {
    expect(openHref({ kind: "note", open: { page: "Acme/Plan.md" }, preview: {} })).toBe("/notes?page=Acme%2FPlan.md")
    expect(openHref({ kind: "timeline", preview: { projectId: "project_1" } })).toBe("/notes?project=project_1")
    expect(openHref({ kind: "tasks", preview: {} })).toBe("/calendar")
    expect(openHref({ kind: "email", preview: {} })).toBeUndefined()
  })

  test("reads the open thread from both thread URL forms", () => {
    expect(sessionFromPath("/server/local/session/ses_1")).toBe("ses_1")
    expect(sessionFromPath("/L3cvYQ/session/ses_2")).toBe("ses_2")
    expect(sessionFromPath("/calendar")).toBeUndefined()
  })
})
