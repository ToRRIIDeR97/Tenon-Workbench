import { describe, expect, test } from "bun:test"
import { MIN_WRITING_MS, openHref, parseAgentWrite, pillWrite, sessionFromPath, writingHold } from "./store"

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
        messageID: "msg_1",
        callID: "call_1",
      },
    })
    expect(write).toMatchObject({
      id: "w1",
      messageID: "msg_1",
      callID: "call_1",
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
    expect(openHref({ kind: "note", open: { page: "Acme/Plan.md" }, preview: {} })).toBe("/projects?page=Acme%2FPlan.md")
    expect(openHref({ kind: "timeline", preview: { projectId: "project_1" } })).toBe("/projects?project=project_1")
    expect(openHref({ kind: "tasks", preview: {} })).toBe("/calendar")
    expect(openHref({ kind: "note", open: { projectId: "project_1" }, preview: {} })).toBe(
      "/projects?project=project_1&tab=log",
    )
    expect(openHref({ kind: "calendar", preview: { events: [{ title: "x", date: "2026-11-03" }] } })).toBe(
      "/calendar?date=2026-11-03",
    )
    expect(
      openHref({ kind: "tasks", preview: { tasks: [{ title: "x" }, { title: "y", dueDate: "2026-11-09" }] } }),
    ).toBe("/calendar?date=2026-11-09")
  })

  test("the pill shows only a recent, unseen write of another thread", () => {
    const base = { directory: "/w", kind: "note", target: "", preview: {}, failed: false, undoState: "idle" } as const
    const writes = [
      { ...base, id: "old", sessionID: "a", phase: "done", at: 0, doneAt: 0, hidden: false },
      { ...base, id: "seen", sessionID: "a", phase: "done", at: 9_000, doneAt: 9_000, hidden: true },
      { ...base, id: "mine", sessionID: "b", phase: "started", at: 9_500, hidden: false },
    ] as const
    expect(pillWrite(writes, "b", 10_000)).toBeUndefined()
    expect(pillWrite(writes, "a", 10_000)?.id).toBe("mine")
    expect(pillWrite([{ ...writes[0], doneAt: 9_000 }], undefined, 10_000)?.id).toBe("old")
  })

  test("holds a fast write in its writing state, never with reduced motion", () => {
    expect(writingHold(1_000, 1_100, false)).toBe(MIN_WRITING_MS - 100)
    expect(writingHold(1_000, 1_000 + MIN_WRITING_MS + 5, false)).toBe(0)
    expect(writingHold(1_000, 1_100, true)).toBe(0)
    expect(openHref({ kind: "email", preview: {} })).toBeUndefined()
  })

  test("reads the open thread from both thread URL forms", () => {
    expect(sessionFromPath("/server/local/session/ses_1")).toBe("ses_1")
    expect(sessionFromPath("/L3cvYQ/session/ses_2")).toBe("ses_2")
    expect(sessionFromPath("/calendar")).toBeUndefined()
  })
})
