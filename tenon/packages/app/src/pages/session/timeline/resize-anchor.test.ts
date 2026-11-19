import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { scheduleConnectedMeasure } from "./measure"
import { resizeAnchoring } from "./resize-anchor"

describe("AC-4 one owner for scrolling on a resize", () => {
  test("a timeline following the bottom keeps the end and scrolls to it", () => {
    expect(resizeAnchoring({ following: true, sinceToggleMs: Infinity })).toEqual({ holdEnd: true, scrollToEnd: true })
  })

  test("just after a card was toggled nothing re-anchors to the end", () => {
    expect(resizeAnchoring({ following: true, sinceToggleMs: 120 })).toEqual({ holdEnd: false, scrollToEnd: false })
  })

  test("a timeline not following the bottom never scrolls to it", () => {
    expect(resizeAnchoring({ following: false, sinceToggleMs: Infinity })).toEqual({
      holdEnd: false,
      scrollToEnd: false,
    })
  })
})

describe("AC-4 a toggled row is measured in the same frame", () => {
  test("measurement runs in a microtask, before the next frame", async () => {
    const element = document.createElement("div")
    document.body.append(element)
    let calls = 0
    scheduleConnectedMeasure(element, () => {
      calls += 1
    })
    await Promise.resolve()
    expect(calls).toBe(1)
    element.remove()
  })

  test("a cancelled measurement never runs", async () => {
    const element = document.createElement("div")
    document.body.append(element)
    let calls = 0
    const cancel = scheduleConnectedMeasure(element, () => {
      calls += 1
    })
    cancel()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(calls).toBe(0)
    element.remove()
  })

  test("both tool group toggles stop following the bottom, like the steps card", () => {
    const source = readFileSync(join(import.meta.dir, "message-timeline.tsx"), "utf8")
    const toggles = source.match(/onOpenChange=\{\(value\) => \{\s*holdBottom\(\)/g) ?? []
    expect(toggles.length).toBe(2)
    expect(source).toContain("resizeAnchoring(")
  })
})
