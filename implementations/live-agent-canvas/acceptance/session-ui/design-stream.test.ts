import { describe, expect, test } from "bun:test"
import {
  DESIGN_FRAME_MESSAGE,
  hasVisibleMarkup,
  liveDesignDocument,
  morphChildren,
  partialDesignMarkup,
} from "../../../../tenon/packages/session-ui/src/components/design-stream"
import { DESIGN_CSP } from "../../../../tenon/packages/session-ui/src/components/design-fence"

describe("AC-3 partialDesignMarkup", () => {
  test("drops a trailing unfinished tag", () => {
    expect(partialDesignMarkup('<div class="a">Hi</div><sec')).toBe('<div class="a">Hi</div>')
    expect(partialDesignMarkup('<p>One</p><a href="x')).toBe("<p>One</p>")
  })
  test("keeps unclosed elements for the parser to close", () => {
    expect(partialDesignMarkup("<main><h1>Tit")).toBe("<main><h1>Tit")
  })
  test("removes scripts while streaming, finished or not", () => {
    expect(partialDesignMarkup("<p>a</p><script>alert(1)</script><p>b</p>")).toBe("<p>a</p><p>b</p>")
    expect(partialDesignMarkup("<p>a</p><SCRIPT type=module>let x = '<p>'")).toBe("<p>a</p>")
  })
  test("removes an unterminated comment", () => {
    expect(partialDesignMarkup("<p>a</p><!-- note <b>")).toBe("<p>a</p>")
  })
})

describe("AC-4 hasVisibleMarkup", () => {
  test.each([
    ["", false],
    ["<style>body{margin:0}</style>", false],
    ["<style>.a{color:red}", false],
    ["<!doctype html><html><head><title>x</title><meta charset=utf-8>", false],
    ["<style>a{}</style><div", false],
    ["<style>a{}</style><div>", true],
    ["Hello", true],
    ["<svg viewBox='0 0 4 4'>", true],
  ])("%s", (source, expected) => {
    expect(hasVisibleMarkup(source)).toBe(expected)
  })
})

describe("AC-5 morphChildren", () => {
  const tree = (html: string) => {
    const el = document.createElement("div")
    el.innerHTML = html
    return el
  }
  test("keeps existing nodes, grows text, appends new elements", () => {
    const live = tree("<header><h1>Pri</h1></header>")
    const header = live.firstElementChild
    const added = morphChildren(live, tree('<header><h1>Pricing</h1></header><section class="cards"><p>One</p></section>'))
    expect(live.innerHTML).toBe('<header><h1>Pricing</h1></header><section class="cards"><p>One</p></section>')
    expect(live.firstElementChild).toBe(header)
    expect(added.map((el) => el.tagName)).toEqual(["SECTION"])
  })
  test("syncs attributes and removes what the new frame no longer has", () => {
    const live = tree('<div class="a" data-x="1"><span>x</span><i>y</i></div>')
    const div = live.firstElementChild
    morphChildren(live, tree('<div class="b"><span>x</span></div>'))
    expect(live.firstElementChild).toBe(div)
    expect(live.innerHTML).toBe('<div class="b"><span>x</span></div>')
  })
})

describe("AC-6 liveDesignDocument", () => {
  const policy = (doc: string) => doc.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? ""
  test("CSP first, then the bootstrap that listens for frames from its parent", () => {
    const doc = liveDesignDocument()
    const csp = doc.indexOf("Content-Security-Policy")
    expect(csp).toBeGreaterThan(-1)
    expect(csp).toBeLessThan(doc.toLowerCase().indexOf("<script"))
    expect(doc).toContain(DESIGN_FRAME_MESSAGE)
    expect(doc).toContain("parent")
  })
  test("scripts need the nonce: the design CSP without unsafe-inline scripts", () => {
    const doc = liveDesignDocument()
    const scriptSrc = policy(doc).split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? ""
    const nonce = scriptSrc.match(/'nonce-([^']+)'/)?.[1]
    expect(nonce).toBeTruthy()
    expect(scriptSrc).not.toContain("unsafe-inline")
    expect(policy(doc)).toContain(DESIGN_CSP.split(";")[0])
    const scripts = doc.match(/<script\b[^>]*>/gi) ?? []
    expect(scripts.length).toBeGreaterThan(0)
    scripts.forEach((tag) => expect(tag).toContain(`nonce="${nonce}"`))
    expect(policy(liveDesignDocument())).not.toBe(policy(doc))
  })
})
