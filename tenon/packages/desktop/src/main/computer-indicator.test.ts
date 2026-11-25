import { describe, expect, test } from "bun:test"
import { GLOW_COLOR, glowPage, indicatorPage, notifyStop, watch } from "./computer-indicator-page"

describe("AC-24 the computer use pill", () => {
  test("names the harness, escapes it, and runs no remote content", () => {
    const page = indicatorPage({ label: 'Gemini <b>"x"</b> is using your computer', stop: "Stop", dark: false })
    expect(page).toContain("Gemini &#60;b&#62;&#34;x&#34;&#60;/b&#62; is using your computer")
    expect(page).toContain("default-src 'none'")
    expect(page).toContain("document.title='stop'")
  })

  test("a held watch answers no stop when it times out or the server gives up", async () => {
    const controller = new AbortController()
    const waiting = watch(controller.signal)
    controller.abort()
    expect(JSON.parse((await waiting).text)).toEqual({ stop: false })
  })

  test("Stop answers every held watch", async () => {
    const waiting = watch(new AbortController().signal)
    notifyStop()
    expect(JSON.parse((await waiting).text)).toEqual({ stop: true })
  })
})

describe("the glow around the screen", () => {
  test("is Tenon blue by default, runs no scripts, and lets clicks through", () => {
    const page = glowPage()
    expect(GLOW_COLOR).toBe("#3b5cf6")
    expect(page).toContain(`${GLOW_COLOR}cc`)
    expect(page).toContain("pointer-events:none")
    expect(page).not.toContain("script-src")
  })

  test("takes another colour, and ignores one that isn't a colour", () => {
    expect(glowPage({ color: "#ff8800" })).toContain("#ff8800cc")
    expect(glowPage({ color: "red;}</style><script>" })).toContain(`${GLOW_COLOR}cc`)
  })
})
