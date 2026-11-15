import { describe, expect, test } from "bun:test"
import { appendToInbox } from "./inbox"

const at = new Date("2026-11-12T09:30:00.000Z")

describe("appendToInbox", () => {
  test("starts a missing Inbox with its heading", () => {
    expect(appendToInbox(undefined, " Call Sam ", at, "Note")).toBe(
      "# Inbox\n\n## Note · 2026-11-12T09:30:00.000Z\n\nCall Sam\n",
    )
    expect(appendToInbox("  \n", "Call Sam", at, "Note")).toStartWith("# Inbox\n\n## Note")
  })

  test("adds the note after what is there, one blank line apart", () => {
    expect(appendToInbox("# Inbox\n\n## Daily brief · x\n\nDone\n\n\n", "Buy tickets", at, "Note")).toBe(
      "# Inbox\n\n## Daily brief · x\n\nDone\n\n## Note · 2026-11-12T09:30:00.000Z\n\nBuy tickets\n",
    )
  })
})
