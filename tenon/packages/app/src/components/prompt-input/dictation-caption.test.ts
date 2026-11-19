import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { mergeCaption } from "./dictation-caption"

describe("AC-6 the live caption only grows", () => {
  test("a partial that extends the caption replaces it", () => {
    expect(mergeCaption("the quick brown", "The quick brown fox jumps")).toBe("The quick brown fox jumps")
  })

  test("a first partial is taken as it is", () => {
    expect(mergeCaption("", "Hello there")).toBe("Hello there")
  })

  test("a window that slid past the first words keeps them", () => {
    const previous = "one two three four five six seven eight nine ten"
    // The engine's window dropped "one two"; the first word it kept was half cut off and heard as "tree".
    const next = "tree four five six seven eight nine ten eleven twelve"
    expect(mergeCaption(previous, next)).toBe("one two three four five six seven eight nine ten eleven twelve")
  })

  test("case and punctuation differences still line up", () => {
    const previous = "So, I think we should ship it today. Then we test."
    const next = "we should ship it today, then we test and merge."
    expect(mergeCaption(previous, next)).toBe("So, I think we should ship it today, then we test and merge.")
  })

  test("a partial that rewrote the opening replaces the caption when nothing lines up", () => {
    expect(mergeCaption("I scream for", "Ice cream for everyone")).toBe("Ice cream for everyone")
  })

  test("a two-minute dictation through a sliding window never drops a word", () => {
    const words = Array.from({ length: 320 }, (_, index) => `w${index}`)
    const windowWords = 70
    let caption = ""
    for (let end = 4; ; end = Math.min(words.length, end + 3)) {
      const start = Math.max(0, end - windowWords)
      const window = words.slice(start, end)
      // Whenever the window has slid, its first word is a cut-off fragment the model mishears.
      if (start > 0) window[0] = "garbled"
      caption = mergeCaption(caption, window.join(" "))
      if (end === words.length) break
    }
    expect(caption).toBe(words.join(" "))
  })

  test("the dictation button merges partials instead of replacing them", () => {
    const source = readFileSync(join(import.meta.dir, "dictation-button.tsx"), "utf8")
    expect(source).toContain("mergeCaption(")
  })
})
