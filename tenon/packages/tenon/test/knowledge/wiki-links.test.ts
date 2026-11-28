import { describe, expect, test } from "bun:test"
import { WikiLinks } from "../../src/knowledge/wiki-links"

describe("AC-6 wiki link keys", () => {
  test("a page is known by its title, path and file name, folded", () => {
    expect([...WikiLinks.pageKeys({ path: "Acme API/Auth Redesign.md", title: "Auth redesign" })].sort()).toEqual(
      ["acme-api/auth-redesign", "auth-redesign"].sort(),
    )
  })

  test("links match by title, path or file name with headings and aliases", () => {
    const keys = WikiLinks.pageKeys({ path: "Acme API/Auth.md", title: "Login plan" })
    expect(WikiLinks.linksTo("See [[Login Plan]].", keys)).toBe(4)
    expect(WikiLinks.linksTo("See [[acme api/auth#Steps|the plan]].", keys)).toBe(4)
    expect(WikiLinks.linksTo("See [[Auth]]", keys)).toBe(4)
    expect(WikiLinks.linksTo("See [[Other]]", keys)).toBe(-1)
  })

  test("links inside code spans and fenced blocks do not count", () => {
    const keys = WikiLinks.pageKeys({ path: "Plan.md", title: "Plan" })
    expect(WikiLinks.linksTo("`[[Plan]]`", keys)).toBe(-1)
    expect(WikiLinks.linksTo("```\n[[Plan]]\n```", keys)).toBe(-1)
    expect(WikiLinks.linksTo("```\n[[Plan]]\n```\nthen [[Plan]]", keys)).toBe(22)
  })
})

describe("AC-8 rewriteLinks", () => {
  test("rewrites matching links to the new target, keeping headings and aliases", () => {
    const keys = WikiLinks.pageKeys({ path: "Plan.md", title: "Plan" })
    const result = WikiLinks.rewriteLinks("[[Plan]], [[plan#Goals]], [[Plan|our plan]], [[Other]]", keys, "Roadmap")
    expect(result).toEqual({ body: "[[Roadmap]], [[Roadmap#Goals]], [[Roadmap|our plan]], [[Other]]", count: 3 })
  })

  test("code is left alone", () => {
    const keys = WikiLinks.pageKeys({ path: "Plan.md", title: "Plan" })
    expect(WikiLinks.rewriteLinks("`[[Plan]]` [[Plan]]", keys, "Roadmap")).toEqual({
      body: "`[[Plan]]` [[Roadmap]]",
      count: 1,
    })
  })
})

describe("snippets", () => {
  test("a snippet surrounds the hit and marks cut ends", () => {
    const text = `${"a".repeat(100)} needle ${"b".repeat(100)}`
    const snippet = WikiLinks.snippet(text, 101, 6, 20)
    expect(snippet.startsWith("…")).toBe(true)
    expect(snippet.endsWith("…")).toBe(true)
    expect(snippet).toContain("needle")
  })
})
