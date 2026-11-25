import { describe, expect, test } from "bun:test"
import { iconPack, iconPackSymbol } from "./icon-pack"

const glyphs: Record<string, string> = iconPack

describe("icon pack", () => {
  test("every destination has its own glyph", () => {
    const destinations = [
      "command-centre",
      "terminal",
      "console",
      "harness",
      "plug",
      "skills",
      "mail",
      "model-profile",
      "sync",
      "book",
      "home",
      "calendar",
      "settings-gear",
    ]
    const bodies = destinations.map((name) => glyphs[name])
    expect(bodies.every(Boolean)).toBe(true)
    expect(new Set(bodies).size).toBe(destinations.length)
  })

  test("names the app relied on falling back to plus now exist", () => {
    for (const name of ["brain", "checklist", "copy", "arrow-right", "circle-check"]) expect(glyphs[name]).toBeDefined()
  })

  test("symbols share one stroke and keep it at every size", () => {
    const symbol = iconPackSymbol(glyphs["terminal"])
    expect(symbol).toStartWith('<g fill="none" stroke="currentColor" stroke-width="1.25"')
    expect(symbol.match(/<(path|rect|circle)\b/g)?.length).toBe(
      symbol.match(/vector-effect="non-scaling-stroke"/g)?.length,
    )
  })
})
