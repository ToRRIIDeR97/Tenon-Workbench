import { describe, expect, test } from "bun:test"
import { placeReplyCard, QUOTE_LIMIT, quoteText } from "./selection-reply-model"
import { replySubmission } from "@/components/prompt-input/reply-bridge"

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

describe("placeReplyCard", () => {
  const viewport = { width: 1200, height: 800 }

  test("grows up from the corner of a pill that sits above the selection", () => {
    expect(placeReplyCard({ left: 500, top: 300, bottom: 340, below: false }, viewport)).toEqual({
      left: 500,
      width: 400,
      top: 340,
      below: false,
    })
  })

  test("grows down from a pill under the selection", () => {
    expect(placeReplyCard({ left: 500, top: 60, bottom: 100, below: true }, viewport)).toEqual({
      left: 500,
      width: 400,
      top: 60,
      below: true,
    })
  })

  test("grows the other way when its side has no room", () => {
    expect(placeReplyCard({ left: 500, top: 40, bottom: 80, below: false }, viewport)).toMatchObject({
      top: 40,
      below: true,
    })
    expect(placeReplyCard({ left: 500, top: 740, bottom: 780, below: true }, viewport)).toMatchObject({
      top: 780,
      below: false,
    })
  })

  test("stays on screen at the edges and in a narrow window", () => {
    expect(placeReplyCard({ left: 4, top: 300, bottom: 340, below: false }, viewport).left).toBe(16)
    expect(placeReplyCard({ left: 1100, top: 300, bottom: 340, below: false }, viewport).left).toBe(784)
    const narrow = placeReplyCard({ left: 100, top: 300, bottom: 340, below: false }, { width: 300, height: 800 })
    expect(narrow).toMatchObject({ left: 16, width: 268 })
  })
})

describe("replySubmission", () => {
  test("sends the passage as a quote that carries the reply", () => {
    const { prompt, context } = replySubmission({ text: "Which providers?", quote: "The provider rejects it." })
    expect(prompt).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
    expect(context).toHaveLength(1)
    expect(context[0]).toMatchObject({ type: "quote", text: "The provider rejects it.", comment: "Which providers?" })
  })
})
