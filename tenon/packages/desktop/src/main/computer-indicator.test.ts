import { describe, expect, test } from "bun:test"
import { indicatorPage, notifyStop, watch } from "./computer-indicator-page"

// #333: the pill that shows while an agent uses the computer, and the Stop it reports.
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
