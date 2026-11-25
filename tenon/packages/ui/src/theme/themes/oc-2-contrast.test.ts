import { describe, expect, test } from "bun:test"
import { contrastRatio } from "../color"
import type { HexColor } from "../types"
import theme from "./oc-2.json"

type Mode = "light" | "dark"
const tokens = (mode: Mode) => theme[mode].v2Overrides as Record<string, string>
const resolve = (mode: Mode, name: string): HexColor => {
  let value = tokens(mode)[name]
  for (let depth = 0; value?.startsWith("var(--") && depth < 8; depth++) value = tokens(mode)[value.slice(6, -1)]
  if (!value?.startsWith("#")) throw new Error(`${mode} ${name} does not resolve to a colour`)
  return value.slice(0, 7) as HexColor
}
const ratio = (mode: Mode, fg: string, bg: string) => contrastRatio(resolve(mode, fg), resolve(mode, bg))

describe("OC-2 warning text", () => {
  for (const mode of ["light", "dark"] as const)
    test(`${mode}: warning text reads on the warning fill and on the page`, () => {
      expect(ratio(mode, "v2-state-fg-warning", "v2-state-bg-warning")).toBeGreaterThanOrEqual(4.5)
      expect(ratio(mode, "v2-state-fg-warning", "v2-background-bg-base")).toBeGreaterThanOrEqual(4.5)
    })
})

describe("OC-2 dark faint text", () => {
  test("reads on base, layer 1 and layer 2", () => {
    for (const surface of ["v2-background-bg-base", "v2-background-bg-layer-01", "v2-background-bg-layer-02"])
      expect(ratio("dark", "v2-text-text-faint", surface)).toBeGreaterThanOrEqual(4.5)
  })
  test("is a distinct step below muted", () => {
    const base = "v2-background-bg-base"
    expect(
      ratio("dark", "v2-text-text-muted", base) / ratio("dark", "v2-text-text-faint", base),
    ).toBeGreaterThanOrEqual(1.15)
  })
})
