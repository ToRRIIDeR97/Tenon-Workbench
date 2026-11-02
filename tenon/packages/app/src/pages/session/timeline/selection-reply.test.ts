import { describe, expect, test } from "bun:test"
import { QUOTE_LIMIT, quoteText } from "./selection-reply"

describe("quoteText", () => {
  test("trims and drops an empty selection", () => {
    expect(quoteText("  \n ")).toBeUndefined()
    expect(quoteText("  a passage \r\n")).toBe("a passage")
  })

  test("keeps paragraphs but folds runs of blank lines", () => {
    expect(quoteText("one\n\n\n\ntwo")).toBe("one\n\ntwo")
  })

  test("cuts a long passage with an ellipsis", () => {
    const text = quoteText("x".repeat(QUOTE_LIMIT + 50))
    expect(text?.length).toBe(QUOTE_LIMIT + 1)
    expect(text?.endsWith("…")).toBe(true)
  })
})
