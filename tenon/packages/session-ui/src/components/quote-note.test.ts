import { describe, expect, test } from "bun:test"
import { createQuoteMetadata, formatQuoteNote, readQuoteMetadata } from "./quote-note"

describe("quote note", () => {
  test("round-trips the quoted text through metadata", () => {
    expect(readQuoteMetadata(createQuoteMetadata("a passage"))).toBe("a passage")
    expect(readQuoteMetadata({ opencodeComment: { path: "a", comment: "b" } })).toBeUndefined()
    expect(readQuoteMetadata({ tenonQuote: { text: "  " } })).toBeUndefined()
  })

  test("quotes every line, keeping blank lines inside the quote", () => {
    expect(formatQuoteNote("one\n\ntwo")).toBe(
      "The user is replying to this passage from your earlier message:\n\n> one\n>\n> two",
    )
  })
})
