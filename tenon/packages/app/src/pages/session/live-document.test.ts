import { describe, expect, test } from "bun:test"
import { isLiveCall, shownTexts } from "./live-document"

describe("shownTexts", () => {
  test("a call's text before is the one shown when it began, not one a reload put there later", () => {
    const shown = shownTexts()
    shown.show("")
    shown.show("plan")
    const written = shown.mark()
    // The watcher reloads the file with the edit before the edit's finished event arrives.
    shown.show("plan, edited")
    expect(shown.at(written)).toBe("plan")
  })

  test("nothing loaded when the call began: the first text loaded after it", () => {
    const shown = shownTexts()
    shown.show("")
    const began = shown.mark()
    shown.show("")
    shown.show("plan")
    shown.show("plan, edited")
    expect(shown.at(began)).toBe("plan")
    expect(shownTexts().at(0)).toBe("")
  })

  test("forget keeps the text shown at the mark", () => {
    const shown = shownTexts()
    shown.show("one")
    shown.show("two")
    const mark = shown.mark()
    shown.show("three")
    shown.forget(mark)
    expect(shown.at(mark)).toBe("two")
    expect(shown.at(shown.mark())).toBe("three")
  })
})

describe("isLiveCall", () => {
  const call = { seen: false, ongoing: false, created: 100, newest: 100 }
  test("history: finished before the view, its reply done", () => {
    expect(isLiveCall(call)).toBe(false)
    expect(isLiveCall({ ...call, newest: undefined, created: 1e15 })).toBe(false)
  })
  test("new: seen running here, reply in progress, or newer than the view's newest message", () => {
    expect(isLiveCall({ ...call, seen: true })).toBe(true)
    expect(isLiveCall({ ...call, ongoing: true })).toBe(true)
    expect(isLiveCall({ ...call, created: 101 })).toBe(true)
  })
})
