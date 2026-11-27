import { afterEach, describe, expect, test } from "bun:test"
import { browserCovered, watchBrowserCover } from "../../../tenon/packages/app/src/pages/session/browser-cover"

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  document.body.innerHTML = ""
})

describe("AC-1 inert content never counts", () => {
  test("a dialog several levels below an inert ancestor is not a cover", () => {
    document.body.innerHTML = '<main><div inert><div><div><div role="dialog"></div></div></div></div></main>'
    expect(browserCovered(document)).toBe(false)
  })

  test("a dialog that is itself inert is not a cover", () => {
    document.body.innerHTML = '<div role="dialog" inert></div>'
    expect(browserCovered(document)).toBe(false)
  })

  test("an expanded stack entry under an inert ancestor is not a cover", () => {
    document.body.innerHTML = '<div inert><div data-component="dialog-stack"><div data-expanded=""></div></div></div>'
    expect(browserCovered(document)).toBe(false)
  })

  test("expanded elements outside the dialog stack are not a cover", () => {
    document.body.innerHTML = '<button data-expanded=""></button><div data-component="dialog-stack"></div>'
    expect(browserCovered(document)).toBe(false)
  })
})

describe("AC-2 any live dialog counts", () => {
  test("one live dialog among several inert ones covers", () => {
    document.body.innerHTML =
      '<div inert><div role="dialog"></div></div><div inert><div role="dialog"></div></div><aside><div role="dialog"></div></aside>'
    expect(browserCovered(document)).toBe(true)
  })

  test("a sibling being inert does not hide a live dialog", () => {
    document.body.innerHTML = '<div inert></div><div role="dialog"></div>'
    expect(browserCovered(document)).toBe(true)
  })
})

describe("AC-3 watching", () => {
  test("open, close, open again reports three changes in order", async () => {
    document.body.innerHTML = '<div id="card" inert><div role="dialog"></div></div>'
    const card = document.getElementById("card")!
    const seen: boolean[] = []
    const stop = watchBrowserCover(document, () => seen.push(browserCovered(document)))
    card.removeAttribute("inert")
    await settle()
    card.setAttribute("inert", "")
    await settle()
    card.removeAttribute("inert")
    await settle()
    stop()
    expect(seen).toEqual([true, false, true])
  })

  test("a stack entry gaining data-expanded reports a change", async () => {
    document.body.innerHTML = '<div data-component="dialog-stack"><div id="entry"></div></div>'
    const seen: boolean[] = []
    const stop = watchBrowserCover(document, () => seen.push(browserCovered(document)))
    document.getElementById("entry")!.setAttribute("data-expanded", "")
    await settle()
    stop()
    expect(seen).toEqual([true])
  })

  test("nothing is reported after stopping", async () => {
    document.body.innerHTML = '<div id="card" inert><div role="dialog"></div></div>'
    const seen: boolean[] = []
    const stop = watchBrowserCover(document, () => seen.push(browserCovered(document)))
    stop()
    document.getElementById("card")!.removeAttribute("inert")
    await settle()
    expect(seen).toEqual([])
  })

  test("unrelated attribute changes are not reported", async () => {
    document.body.innerHTML = '<div id="card" inert><div role="dialog"></div></div>'
    const seen: boolean[] = []
    const stop = watchBrowserCover(document, () => seen.push(browserCovered(document)))
    document.getElementById("card")!.setAttribute("class", "x")
    document.getElementById("card")!.setAttribute("aria-label", "y")
    await settle()
    stop()
    expect(seen).toEqual([])
  })
})
