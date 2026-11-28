import { describe, expect, test } from "bun:test"
import { parseInbox, removeInboxEntry } from "./inbox-triage"

describe("AC-14 inbox (verification)", () => {
  test("a section heading typed by hand without a time is not an entry", () => {
    expect(parseInbox("# Inbox\n\n## Ideas\n\nnot captured")).toEqual([])
  })

  test("Windows line endings are read", () => {
    const body = "# Inbox\r\n\r\n## Note · 2026-11-27T10:00:00.000Z\r\n\r\nfrom windows\r\n"
    expect(parseInbox(body).map((entry) => entry.text)).toEqual(["from windows"])
  })

  test("removing an unknown id changes nothing", () => {
    const body = "# Inbox\n\n## Note · 2026-11-27T10:00:00.000Z\n\none\n"
    expect(removeInboxEntry(body, "missing")).toBe(body)
  })

  test("removing the last entry leaves the heading", () => {
    const body = "# Inbox\n\n## Note · 2026-11-27T10:00:00.000Z\n\none\n"
    const [entry] = parseInbox(body)
    expect(removeInboxEntry(body, entry!.id).trim()).toBe("# Inbox")
  })

  test("two entries with the same text and time still get different ids", () => {
    const body = "# Inbox\n\n## Note · 2026-11-27T10:00:00.000Z\n\nsame\n\n## Note · 2026-11-27T10:00:00.000Z\n\nsame\n"
    const entries = parseInbox(body)
    expect(entries.length).toBe(2)
    expect(entries[0]!.id).not.toBe(entries[1]!.id)
    expect(parseInbox(removeInboxEntry(body, entries[1]!.id)).length).toBe(1)
  })
})
