import { describe, expect, test } from "bun:test"
import { SHOWN_LIMIT, isLiveCall, shownTexts } from "./live-document"

describe("shownTexts", () => {
  test("a call's text before is the one shown when it began, not one a reload put there later", () => {
    const shown = shownTexts()
    shown.show("", [])
    shown.show("plan", [])
    const written = shown.mark()
    // The watcher reloads the file with the edit before the edit's finished event arrives.
    shown.show("plan, edited", [written])
    expect(shown.at(written)).toBe("plan")
  })

  test("nothing loaded when the call began: the first text loaded after it", () => {
    const shown = shownTexts()
    shown.show("", [])
    const began = shown.mark()
    shown.show("x", [began])
    shown.show("", [began])
    shown.show("plan", [began])
    shown.show("plan, edited", [began])
    expect(shown.at(began)).toBe("x")
    expect(shownTexts().at(0)).toBe("")
  })

  test("with no open call only the latest text stays", () => {
    const shown = shownTexts()
    Array.from({ length: 1000 }, (_, index) => shown.show(`text ${index}`, []))
    expect(shown.size()).toBe(1)
    expect(shown.at(1)).toBe("text 999")
  })

  test("with an open call the texts before its mark go", () => {
    const shown = shownTexts()
    Array.from({ length: 10 }, (_, index) => shown.show(`early ${index}`, []))
    shown.show("plan", [])
    const began = shown.mark()
    Array.from({ length: 1000 }, (_, index) => shown.show(`later ${index}`, [began]))
    expect(shown.size()).toBe(2)
    expect(shown.at(began)).toBe("plan")
    expect(shown.at(began - 1)).toBe("plan")
    expect(shown.at(shown.mark())).toBe("later 999")
  })

  test("never more than the limit, whatever the marks", () => {
    const shown = shownTexts()
    const marks: number[] = []
    Array.from({ length: 100 }, (_, index) => {
      shown.show(`text ${index}`, marks)
      marks.push(shown.mark())
    })
    expect(shown.size()).toBe(SHOWN_LIMIT)
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
