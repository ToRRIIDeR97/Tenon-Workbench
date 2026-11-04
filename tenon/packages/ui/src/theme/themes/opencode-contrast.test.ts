import { describe, expect, test } from "bun:test"
import { contrastRatio } from "../color"
import type { HexColor } from "../types"
import opencode from "./opencode.json"

const ratio = (foreground: string, background: string) => contrastRatio(foreground as HexColor, background as HexColor)

describe("OpenCode theme contrast", () => {
  test("dark: secondary text leads tertiary, and both read on tool rows", () => {
    const tokens = opencode.dark.v2Overrides
    const row = "#2c2c2c"
    expect(ratio(tokens["v2-text-text-faint"], row)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(tokens["v2-text-text-muted"], row)).toBeGreaterThan(ratio(tokens["v2-text-text-faint"], row))
  })

  test("dark: text on the accent fill reads", () => {
    expect(ratio(opencode.dark.v2Overrides["v2-text-text-contrast"], "#e58b4d")).toBeGreaterThanOrEqual(4.5)
  })

  test("light: secondary text leads tertiary, and both read on tool rows", () => {
    const tokens = opencode.light.v2Overrides
    const row = "#ededed"
    expect(ratio(tokens["v2-text-text-faint"], row)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(tokens["v2-text-text-muted"], row)).toBeGreaterThan(ratio(tokens["v2-text-text-faint"], row))
  })

  test("light: white reads on the accent fill", () => {
    expect(ratio("#ffffff", opencode.light.v2Overrides["v2-background-bg-accent"])).toBeGreaterThanOrEqual(4.5)
  })
})
