import { describe, expect, test } from "bun:test"
import { TYPE_MS, greetingPrompt, typedCount } from "./greeting"

describe("greetingPrompt", () => {
  test("maps a random number onto one of the five prompts", () => {
    expect([0, 0.19, 0.2, 0.5, 0.99, 0.999999].map(greetingPrompt)).toEqual([1, 1, 2, 3, 5, 5])
  })
})

describe("typedCount", () => {
  test("types any line in over the same time, then holds the whole line", () => {
    expect(typedCount(0, 40)).toBe(0)
    expect(typedCount(TYPE_MS / 2, 40)).toBe(20)
    expect(typedCount(TYPE_MS, 40)).toBe(40)
    expect(typedCount(TYPE_MS * 3, 40)).toBe(40)
    expect(typedCount(TYPE_MS / 2, 10)).toBe(5)
  })
})
