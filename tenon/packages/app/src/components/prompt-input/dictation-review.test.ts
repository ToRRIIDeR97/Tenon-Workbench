import { describe, expect, test } from "bun:test"
import { captionChanges, dictationLanguageName, replaceBeforeCaret } from "./dictation-review"

// #328: the caption names the language in use, and a final transcript that differs from it is flagged and can be
// swapped back.
describe("dictationLanguageName", () => {
  test("AC-4 a language code is named in the app's language", () => {
    expect(dictationLanguageName("en", "en")).toBe("English")
    expect(dictationLanguageName("zh", "en")).toBe("Chinese")
    expect(dictationLanguageName("fr", "de")).toBe("Französisch")
  })

  test("AC-4 no code means the model detects the language", () => {
    expect(dictationLanguageName(undefined, "en")).toBeUndefined()
  })
})

describe("captionChanges", () => {
  test("AC-5 case and punctuation don't count", () => {
    expect(captionChanges("hello world, this is it", "Hello world. This is it!")).toBe(0)
  })

  test("AC-5 replaced, added and dropped words count once each", () => {
    expect(captionChanges("I want two apples", "I want to apples")).toBe(1)
    expect(captionChanges("send it now", "send it right now")).toBe(1)
    expect(captionChanges("um send it", "send it")).toBe(1)
    expect(captionChanges("the quick fox", "a slow fox jumps")).toBe(3)
  })

  test("AC-5 nothing shown means nothing to compare", () => {
    expect(captionChanges("", "anything at all")).toBe(0)
    expect(captionChanges("   ", "anything")).toBe(0)
  })
})

describe("replaceBeforeCaret", () => {
  const editor = (text: string) => {
    document.body.innerHTML = ""
    const element = document.createElement("div")
    element.contentEditable = "true"
    element.textContent = text
    document.body.append(element)
    element.focus()
    const node = element.firstChild!
    const range = document.createRange()
    range.setStart(node, node.textContent!.length)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    return element
  }

  test("AC-6 swaps the just-inserted text for the caption", () => {
    const element = editor("Note: please send it right now")
    expect(replaceBeforeCaret(" please send it right now", " please send it now")).toBe(true)
    expect(element.textContent).toBe("Note: please send it now")
  })

  test("AC-6 changes nothing once the text before the caret is different", () => {
    const element = editor("Note: please send it right now and more")
    expect(replaceBeforeCaret(" please send it right now", " please send it now")).toBe(false)
    expect(element.textContent).toBe("Note: please send it right now and more")
  })
})

// AC-6 also covers the textarea composers (Home, the Command Centre page and card), not just the thread's editor.
describe("replaceBeforeCaret in a textarea", () => {
  const field = (text: string) => {
    document.body.innerHTML = ""
    const element = document.createElement("textarea")
    element.value = text
    document.body.append(element)
    element.focus()
    element.setSelectionRange(text.length, text.length)
    return element
  }

  test("AC-6 swaps the just-inserted text for the caption", () => {
    const element = field("Note: please send it right now")
    expect(replaceBeforeCaret(" please send it right now", " please send it now")).toBe(true)
    expect(element.value).toBe("Note: please send it now")
  })

  test("AC-6 changes nothing once the text before the caret is different", () => {
    const element = field("Note: please send it right now and more")
    expect(replaceBeforeCaret(" please send it right now", " please send it now")).toBe(false)
    expect(element.value).toBe("Note: please send it right now and more")
  })
})
