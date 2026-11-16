import { describe, expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import { DESIGN_CSP, designDocument } from "./design-fence"
import { DESIGN_FRAME_MESSAGE, liveDesignDocument, morphChildren, partialDesignMarkup } from "./design-stream"

describe("partialDesignMarkup", () => {
  test("keeps closed comments and a lone style", () => {
    expect(partialDesignMarkup("<!-- a --><p>x</p>")).toBe("<!-- a --><p>x</p>")
    expect(partialDesignMarkup("<style>.a{color:red}")).toBe("<style>.a{color:red}")
  })

  test("cuts at the first comment that never closes", () => {
    expect(partialDesignMarkup("<p>a</p><!-- a > b <!-- c")).toBe("<p>a</p>")
    expect(partialDesignMarkup("<!-- a --><p>x</p><!-- b")).toBe("<!-- a --><p>x</p>")
  })
})

describe("live frame script policy", () => {
  const policy = (doc: string) => doc.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? ""

  test("only nonced scripts may run, with a fresh nonce per document", () => {
    const doc = liveDesignDocument()
    const nonce = policy(doc).match(/script-src 'nonce-([0-9a-f]{32})'/)?.[1]
    expect(nonce).toBeTruthy()
    expect(policy(doc)).toBe(DESIGN_CSP.replace("script-src 'unsafe-inline'", `script-src 'nonce-${nonce}'`))
    expect(doc.match(/<script\b[^>]*>/gi)).toEqual([`<script nonce="${nonce}">`, `<script nonce="${nonce}">`])
    expect(policy(liveDesignDocument())).not.toBe(policy(doc))
  })

  test("theme values can't end the bootstrap script or open a comment", () => {
    const doc = liveDesignDocument({
      accent: "red</script><script>alert(1)</script><!--",
      easing: "ease-out;}</script>",
    })
    expect(doc).not.toContain("alert(1)")
    expect(doc).not.toContain("<!--")
    expect(doc.match(/<\/script>/gi)).toHaveLength(2)
    expect(doc).toContain('const accent="Highlight"')
    expect(doc).toContain('const easing="ease-out"')
    const plain = liveDesignDocument({ accent: "rgb(10 20 30 / 50%)", easing: "cubic-bezier(0.05, 0.7, 0.1, 1)" })
    expect(plain).toContain('const accent="rgb(10 20 30 / 50%)"')
    expect(plain).toContain('const easing="cubic-bezier(0.05, 0.7, 0.1, 1)"')
  })

  test("finished designs keep the inline script policy", () => {
    expect(policy(designDocument("<p>x</p>"))).toBe(DESIGN_CSP)
    expect(designDocument("<p>x</p>")).not.toContain("nonce")
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
  const boot = (reduced = true) => {
    const script = liveDesignDocument().match(/<script nonce="\w+">(\(\(\)=>\{const __name[\s\S]*?)<\/script>/)?.[1]
    const listeners: ((event: { source: unknown; data: unknown }) => void)[] = []
    const parent = {}
    document.body.innerHTML = ""
    runInNewContext(script ?? "", {
      document,
      parent,
      Element,
      matchMedia: () => ({ matches: reduced }),
      addEventListener: (_: string, listener: (typeof listeners)[number]) => listeners.push(listener),
    })
    return {
      send: (source: unknown, data: unknown) => listeners.forEach((listener) => listener({ source, data })),
      parent,
    }
  }
  // The element being written carries an outline mark; the shape tests ignore it.
  const html = () => document.body.innerHTML.replaceAll(' data-tenon-writing=""', "")

  test("morphs frames from the parent into the body", () => {
    const frame = boot()
    frame.send(frame.parent, { type: DESIGN_FRAME_MESSAGE, markup: "<main><h1>Pri</h1></main>" })
    const main = document.body.firstElementChild
    frame.send(frame.parent, { type: DESIGN_FRAME_MESSAGE, markup: "<main><h1>Pricing</h1></main><p>x</p>" })
    expect(html()).toBe("<main><h1>Pricing</h1></main><p>x</p>")
    expect(document.body.firstElementChild).toBe(main)
  })

  test("ignores other senders and other shapes", () => {
    const frame = boot()
    frame.send({}, { type: DESIGN_FRAME_MESSAGE, markup: "<p>other</p>" })
    frame.send(frame.parent, { type: "other", markup: "<p>other</p>" })
    frame.send(frame.parent, { type: DESIGN_FRAME_MESSAGE, markup: 1 })
    frame.send(frame.parent, "<p>other</p>")
    expect(html()).toBe("")
  })

  test("drops scripts, handlers and nested frames", () => {
    const frame = boot()
    frame.send(frame.parent, {
      type: DESIGN_FRAME_MESSAGE,
      markup: '<p onclick="x()">a</p><script>x()</script><iframe srcdoc="x"></iframe><a href="javascript:x()">b</a>',
    })
    expect(html()).toBe("<p>a</p><a>b</a>")
  })

  test("drops javascript: URLs spelled with control characters", () => {
    const frame = boot()
    frame.send(frame.parent, {
      type: DESIGN_FRAME_MESSAGE,
      markup: '<a href="java&#9;script:x()">a</a><a href=" &#10;JavaScript:x()">b</a><a href="https://x.test/">c</a>',
    })
    expect(html()).toBe('<a>a</a><a>b</a><a href="https://x.test/">c</a>')
  })

  test("drops SVG animations that could set a javascript: href", () => {
    const frame = boot()
    frame.send(frame.parent, {
      type: DESIGN_FRAME_MESSAGE,
      markup:
        '<svg><a><animate attributeName="href" values="0;javascript:x()"></animate><set attributeName="href" to="javascript:x()"></set><animateMotion></animateMotion><animateTransform></animateTransform><text>t</text></a></svg>',
    })
    expect(document.body.querySelectorAll("animate, set, animateMotion, animateTransform").length).toBe(0)
    expect(document.body.querySelector("text")?.textContent).toBe("t")
  })

  test("outlines the deepest last element that draws, skipping trailing styles", () => {
    const frame = boot()
    frame.send(frame.parent, {
      type: DESIGN_FRAME_MESSAGE,
      markup: "<main><h1>A</h1><section><p>One</p><p>Tw</p></section><style>p{}</style></main>",
    })
    expect(Array.from(document.querySelectorAll("[data-tenon-writing]"), (el) => el.textContent)).toEqual(["Tw"])
    frame.send(frame.parent, { type: DESIGN_FRAME_MESSAGE, markup: "<main><h1>A</h1></main><footer>F</footer>" })
    expect(Array.from(document.querySelectorAll("[data-tenon-writing]"), (el) => el.textContent)).toEqual(["F"])
  })

  test("fades in only the inserted elements, and nothing under reduced motion", () => {
    const animated: string[] = []
    const original = Element.prototype.animate
    Element.prototype.animate = function (this: Element) {
      animated.push(this.tagName)
      return {} as Animation
    }
    const moving = boot(false)
    moving.send(moving.parent, { type: DESIGN_FRAME_MESSAGE, markup: "<main><h1>A</h1></main>" })
    moving.send(moving.parent, { type: DESIGN_FRAME_MESSAGE, markup: "<main><h1>A</h1><p>B</p></main>" })
    const still = boot(true)
    still.send(still.parent, { type: DESIGN_FRAME_MESSAGE, markup: "<main><h1>A</h1></main>" })
    Element.prototype.animate = original
    expect(animated).toEqual(["MAIN", "P"])
  })
})
