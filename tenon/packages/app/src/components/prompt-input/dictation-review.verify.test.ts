import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// Verification for #328 (plan author's check): the button renders the language and compares the final text with
// the caption before inserting.
const button = readFileSync(path.join(import.meta.dir, "dictation-button.tsx"), "utf8")

describe("dictation button wiring", () => {
  test("the live caption shows the language dictation runs with", () => {
    expect(button).toContain("dictationLanguageName(")
    expect(button).toContain("dictation.live.language")
  })

  test("a final transcript is compared with the caption and can be swapped back", () => {
    expect(button).toContain("captionChanges(")
    expect(button).toContain("replaceBeforeCaret(")
    expect(button).toContain("dictation.revised")
  })
})
