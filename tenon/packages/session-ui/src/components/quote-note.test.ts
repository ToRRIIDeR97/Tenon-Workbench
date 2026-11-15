import { describe, expect, test } from "bun:test"
import { createQuoteMetadata, formatQuoteNote, readQuoteMetadata, splitQuoteNotes } from "./quote-note"

describe("quote note", () => {
  test("round-trips the passage and reply through metadata", () => {
    expect(readQuoteMetadata(createQuoteMetadata("a passage"))).toEqual({ text: "a passage" })
    expect(readQuoteMetadata(createQuoteMetadata("a passage", " why? "))).toEqual({ text: "a passage", reply: "why?" })
    expect(readQuoteMetadata(createQuoteMetadata("a passage", "  "))).toEqual({ text: "a passage" })
    expect(readQuoteMetadata({ opencodeComment: { path: "a", comment: "b" } })).toBeUndefined()
    expect(readQuoteMetadata({ tenonQuote: { text: "  " } })).toBeUndefined()
  })

  test("quotes every line, keeping blank lines inside the quote", () => {
    expect(formatQuoteNote("one\n\ntwo")).toBe(
      "The user is replying to this passage from your earlier message:\n\n> one\n>\n> two",
    )
  })

  test("adds the user's reply after the passage", () => {
    expect(formatQuoteNote("one", "Why?")).toBe(
      "The user is replying to this passage from your earlier message:\n\n> one\n\nTheir reply: Why?",
    )
  })
})

describe("splitQuoteNotes", () => {
  test("leaves a message without notes as it is", () => {
    expect(splitQuoteNotes("hi there")).toEqual({ text: "hi there", quotes: [] })
  })

  test("recovers the typed text and each passage with its reply, as a harness message holds them", () => {
    const message = [
      "hi there",
      formatQuoteNote("first\n\npassage", "Which one?\nAnd why?"),
      formatQuoteNote("second"),
    ].join("\n")
    expect(splitQuoteNotes(message)).toEqual({
      text: "hi there",
      quotes: [{ text: "first\n\npassage", reply: "Which one?\nAnd why?" }, { text: "second" }],
    })
  })

  test("handles a message that is only notes", () => {
    expect(splitQuoteNotes(formatQuoteNote("only", "ok"))).toEqual({
      text: "",
      quotes: [{ text: "only", reply: "ok" }],
    })
  })
})
