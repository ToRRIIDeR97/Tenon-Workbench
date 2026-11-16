import { describe, expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import { DESIGN_FRAME_MESSAGE, liveDesignDocument, morphChildren, partialDesignMarkup } from "./design-stream"

describe("partialDesignMarkup", () => {
  test("keeps closed comments and a lone style", () => {
    expect(partialDesignMarkup("<!-- a --><p>x</p>")).toBe("<!-- a --><p>x</p>")
    expect(partialDesignMarkup("<style>.a{color:red}")).toBe("<style>.a{color:red}")
  })
})

// These need a DOM: run with `bun test --preload ../app/happydom.ts src/components/design-stream.test.ts`.
const dom = typeof document === "undefined"

describe.skipIf(dom)("morphChildren", () => {
  test("reports elements inserted inside a kept parent, in document order", () => {
    const live = document.createElement("div")
    live.innerHTML = "<main><p>a</p></main>"
    const next = document.createElement("div")
    next.innerHTML = "<main><p>a</p><p>b</p></main><footer></footer>"
    expect(morphChildren(live, next).map((el) => el.outerHTML)).toEqual(["<p>b</p>", "<footer></footer>"])
  })

  test("replaces a node of another name", () => {
    const live = document.createElement("div")
    live.innerHTML = "<p>a</p>"
    const next = document.createElement("div")
    next.innerHTML = "<h2>a</h2>"
    expect(morphChildren(live, next).map((el) => el.tagName)).toEqual(["H2"])
    expect(live.innerHTML).toBe("<h2>a</h2>")
  })
})

describe.skipIf(dom)("liveDesignDocument bootstrap", () => {
  const boot = () => {
    const script = liveDesignDocument().match(/<script>(\(\(\)=>\{const __name[\s\S]*?)<\/script>/)?.[1]
    const listeners: ((event: { source: unknown; data: unknown }) => void)[] = []
    const parent = {}
    document.body.innerHTML = ""
    runInNewContext(script ?? "", {
      document,
      parent,
      Element,
      addEventListener: (_: string, listener: (typeof listeners)[number]) => listeners.push(listener),
    })
    return {
      send: (source: unknown, data: unknown) => listeners.forEach((listener) => listener({ source, data })),
      parent,
    }
  }

  test("morphs frames from the parent into the body", () => {
    const frame = boot()
    frame.send(frame.parent, { type: DESIGN_FRAME_MESSAGE, markup: "<main><h1>Pri</h1></main>" })
    const main = document.body.firstElementChild
    frame.send(frame.parent, { type: DESIGN_FRAME_MESSAGE, markup: "<main><h1>Pricing</h1></main><p>x</p>" })
    expect(document.body.innerHTML).toBe("<main><h1>Pricing</h1></main><p>x</p>")
    expect(document.body.firstElementChild).toBe(main)
  })

  test("ignores other senders and other shapes", () => {
    const frame = boot()
    frame.send({}, { type: DESIGN_FRAME_MESSAGE, markup: "<p>other</p>" })
    frame.send(frame.parent, { type: "other", markup: "<p>other</p>" })
    frame.send(frame.parent, { type: DESIGN_FRAME_MESSAGE, markup: 1 })
    frame.send(frame.parent, "<p>other</p>")
    expect(document.body.innerHTML).toBe("")
  })

  test("drops scripts, handlers and nested frames", () => {
    const frame = boot()
    frame.send(frame.parent, {
      type: DESIGN_FRAME_MESSAGE,
      markup: '<p onclick="x()">a</p><script>x()</script><iframe srcdoc="x"></iframe><a href="javascript:x()">b</a>',
    })
    expect(document.body.innerHTML).toBe("<p>a</p><a>b</a>")
  })
})
