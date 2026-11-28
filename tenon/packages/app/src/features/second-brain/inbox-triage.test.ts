import { describe, expect, test } from "bun:test"
import { parseInbox, removeInboxEntry } from "./inbox-triage"
import { appendToInbox } from "@/features/desktop-widget/inbox"

describe("AC-14 parseInbox", () => {
  test("reads every captured section", () => {
    let body = appendToInbox(undefined, "Buy milk", new Date("2026-11-27T10:00:00.000Z"), "Note")
    body = appendToInbox(body, "Call Ana\nabout the plan", new Date("2026-11-28T08:00:00.000Z"), "Phone")
    const entries = parseInbox(body)
    expect(entries.map(({ label, at, text }) => ({ label, at, text }))).toEqual([
      { label: "Note", at: "2026-11-27T10:00:00.000Z", text: "Buy milk" },
      { label: "Phone", at: "2026-11-28T08:00:00.000Z", text: "Call Ana\nabout the plan" },
    ])
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2)
  })

  test("a body without sections has no entries", () => {
    expect(parseInbox("# Inbox\n\nloose text")).toEqual([])
    expect(parseInbox("")).toEqual([])
  })
})

describe("AC-14 removeInboxEntry", () => {
  test("removes only the chosen section", () => {
    let body = appendToInbox(undefined, "one", new Date("2026-11-27T10:00:00.000Z"), "Note")
    body = appendToInbox(body, "two", new Date("2026-11-27T11:00:00.000Z"), "Note")
    body = appendToInbox(body, "three", new Date("2026-11-27T12:00:00.000Z"), "Note")
    const [, second] = parseInbox(body)
    const next = removeInboxEntry(body, second!.id)
    expect(parseInbox(next).map((entry) => entry.text)).toEqual(["one", "three"])
    expect(next.startsWith("# Inbox\n\n## Note · 2026-11-27T10:00:00.000Z\n\none\n")).toBe(true)
  })
})
