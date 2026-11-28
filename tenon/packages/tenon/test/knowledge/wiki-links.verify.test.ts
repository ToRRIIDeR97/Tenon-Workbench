import { describe, expect, test } from "bun:test"
import { WikiLinks } from "../../src/knowledge/wiki-links"

describe("AC-6/AC-8 wiki links (verification)", () => {
  test("an escaped link is not a link", () => {
    const keys = WikiLinks.pageKeys({ path: "Plan.md", title: "Plan" })
    expect(WikiLinks.linksTo("\\[[Plan]]", keys)).toBe(-1)
  })

  test("a link to a block reference still counts", () => {
    const keys = WikiLinks.pageKeys({ path: "Plan.md", title: "Plan" })
    expect(WikiLinks.linksTo("[[Plan^abc123]]", keys)).toBe(0)
  })

  test("rewrite keeps a block reference and leaves tilde fences alone", () => {
    const keys = WikiLinks.pageKeys({ path: "Notes/Plan.md", title: "Plan" })
    expect(WikiLinks.rewriteLinks("~~~\n[[Plan]]\n~~~\n[[Notes/Plan^x]]", keys, "New Plan")).toEqual({
      body: "~~~\n[[Plan]]\n~~~\n[[New Plan^x]]",
      count: 1,
    })
  })

  test("nothing to rewrite returns the same body and zero", () => {
    const keys = WikiLinks.pageKeys({ path: "Plan.md", title: "Plan" })
    expect(WikiLinks.rewriteLinks("no links here", keys, "X")).toEqual({ body: "no links here", count: 0 })
  })

  test("a short text needs no ellipsis", () => {
    expect(WikiLinks.snippet("short needle text", 6, 6, 40)).toBe("short needle text")
  })
})
