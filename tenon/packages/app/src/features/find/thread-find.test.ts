import { describe, expect, test } from "bun:test"
import { threadFindMatches, threadFindTurns } from "./thread-find"

const messages = [
  { id: "u1", role: "user" as const },
  { id: "a1", role: "assistant" as const, parentID: "u1" },
  { id: "u2", role: "user" as const },
  { id: "a2", role: "assistant" as const, parentID: "u2" },
  { id: "a2b", role: "assistant" as const, parentID: "u2" },
]

const parts: Record<string, ReadonlyArray<{ type: string; text?: string; synthetic?: boolean; ignored?: boolean }>> = {
  u1: [{ type: "text", text: "Why is the rate limit hit?" }],
  a1: [
    { type: "reasoning", text: "rate limit thinking" },
    { type: "text", text: "The rate limit is 10 per second." },
  ],
  u2: [
    { type: "text", text: "Raise the limit" },
    { type: "text", text: "hidden rate limit context", synthetic: true },
  ],
  a2: [{ type: "tool", text: "rate limit in a tool" }],
  a2b: [{ type: "text", text: "Done: rate limit raised. Rate limit now 20." }],
}

describe("AC-2 threadFindTurns", () => {
  test("one entry per user turn with its own and its replies' text parts", () => {
    expect(threadFindTurns(messages, parts)).toEqual([
      { turnID: "u1", texts: ["Why is the rate limit hit?", "The rate limit is 10 per second."] },
      { turnID: "u2", texts: ["Raise the limit", "Done: rate limit raised. Rate limit now 20."] },
    ])
  })
})

describe("AC-2 threadFindMatches", () => {
  test("lists matches in thread order with a per-turn occurrence", () => {
    expect(threadFindMatches(threadFindTurns(messages, parts), "rate limit")).toEqual([
      { turnID: "u1", occurrence: 0 },
      { turnID: "u1", occurrence: 1 },
      { turnID: "u2", occurrence: 0 },
      { turnID: "u2", occurrence: 1 },
    ])
  })

  test("an empty query has no matches", () => {
    expect(threadFindMatches(threadFindTurns(messages, parts), " ")).toEqual([])
  })
})
