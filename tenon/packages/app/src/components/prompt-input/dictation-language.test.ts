import { describe, expect, test } from "bun:test"
import { dictationLanguage } from "./dictation-language"

describe("AC-6 dictationLanguage", () => {
  test("the default is English for an English app and detection otherwise", () => {
    expect(dictationLanguage(undefined, "en")).toBe("en")
    expect(dictationLanguage(undefined, "en-GB")).toBe("en")
    expect(dictationLanguage(undefined, "es")).toBeUndefined()
    expect(dictationLanguage(undefined, "zh-Hant")).toBeUndefined()
  })

  test("following the app uses its language, Traditional Chinese included", () => {
    expect(dictationLanguage("app", "es")).toBe("es")
    expect(dictationLanguage("app", "zht")).toBe("zh")
  })

  test("an explicit choice wins, and auto asks the engine to detect", () => {
    expect(dictationLanguage("de", "en")).toBe("de")
    expect(dictationLanguage("auto", "en")).toBeUndefined()
  })
})
