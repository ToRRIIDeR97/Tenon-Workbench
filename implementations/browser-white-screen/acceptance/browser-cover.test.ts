import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { browserCovered, watchBrowserCover } from "../../../tenon/packages/app/src/pages/session/browser-cover"

const app = path.resolve(import.meta.dir, "../../../tenon/packages/app/src")
const read = (file: string) => readFileSync(path.join(app, file), "utf8")

const closedCard = '<div data-command-strip-card inert><div role="dialog" aria-label="Command Centre"></div></div>'
const openCard = '<div data-command-strip-card><div role="dialog" aria-label="Command Centre"></div></div>'

const mount = (html: string) => {
  const host = document.createElement("div")
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  document.body.innerHTML = ""
})

describe("AC-1 the closed Command Centre card does not hide the page", () => {
  test("a dialog inside an inert wrapper is not a cover", () => {
    mount(closedCard)
    expect(browserCovered(document)).toBe(false)
  })

  test("an empty document is not covered", () => {
    expect(browserCovered(document)).toBe(false)
  })

  test("the closed card is still marked inert in the app", () => {
    expect(read("features/command-centre/command-strip.tsx")).toMatch(
      /data-command-strip-card[\s\S]{0,80}inert=\{state\.open \? undefined : true\}/,
    )
  })
})

describe("AC-2 an open dialog still hides the page", () => {
  test("the open Command Centre card covers", () => {
    mount(openCard)
    expect(browserCovered(document)).toBe(true)
  })

  test("an expanded dialog in the dialog stack covers", () => {
    mount('<div data-component="dialog-stack"><div data-expanded=""></div></div>')
    expect(browserCovered(document)).toBe(true)
  })

  test("an open dialog covers while the closed card is also mounted", () => {
    mount(closedCard)
    mount('<section role="dialog"></section>')
    expect(browserCovered(document)).toBe(true)
  })
})

describe("AC-3 the tab hears the card open and close", () => {
  test("toggling inert on the card reports a change each time", async () => {
    const host = mount(closedCard)
    const card = host.firstElementChild!
    const seen: boolean[] = []
    const stop = watchBrowserCover(document, () => seen.push(browserCovered(document)))
    card.removeAttribute("inert")
    await settle()
    card.setAttribute("inert", "")
    await settle()
    stop()
    expect(seen).toEqual([true, false])
  })

  test("a dialog added and removed reports a change each time", async () => {
    const seen: boolean[] = []
    const stop = watchBrowserCover(document, () => seen.push(browserCovered(document)))
    const host = mount('<section role="dialog"></section>')
    await settle()
    host.remove()
    await settle()
    stop()
    expect(seen).toEqual([true, false])
  })
})

describe("AC-4 the Browser tab uses the cover rule", () => {
  test("browser-tab.tsx decides cover through browserCovered and watchBrowserCover", () => {
    const source = read("pages/session/browser-tab.tsx")
    expect(source).toContain("browserCovered(document)")
    expect(source).toContain("watchBrowserCover(document")
    expect(source).not.toContain('querySelector(\'[role="dialog"]')
  })
})
