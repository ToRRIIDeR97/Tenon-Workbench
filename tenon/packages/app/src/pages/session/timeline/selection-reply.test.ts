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

  test("sits under the selection, centred, when it fits", () => {
    expect(placeReplyCard({ x: 600, top: 200, bottom: 220 }, viewport)).toEqual({
      left: 390,
      width: 420,
      top: 228,
      below: true,
    })
  })

  test("goes above a selection near the bottom of the window", () => {
    const placed = placeReplyCard({ x: 600, top: 700, bottom: 720 }, viewport)
    expect(placed.below).toBe(false)
    expect(placed.top).toBe(692)
  })

  test("stays on screen at the edges and in a narrow window", () => {
    expect(placeReplyCard({ x: 10, top: 200, bottom: 220 }, viewport).left).toBe(16)
    expect(placeReplyCard({ x: 1190, top: 200, bottom: 220 }, viewport).left).toBe(764)
    const narrow = placeReplyCard({ x: 150, top: 200, bottom: 220 }, { width: 300, height: 800 })
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
