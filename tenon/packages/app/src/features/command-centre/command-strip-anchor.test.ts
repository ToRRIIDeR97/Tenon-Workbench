import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { commandStripStyle } from "./command-strip-anchor"

describe("command strip anchor", () => {
  test("off a thread the strip sits at the page's bottom centre", () => {
    expect(commandStripStyle(undefined)).toEqual({
      bottom: "calc(0.5rem + 0px)",
      left: "50%",
      width: "min(640px, calc(100% - 32px))",
    })
  })

  test("on a thread it sits on the composer, at most 640px wide", () => {
    expect(commandStripStyle({ lift: 150, center: 439, span: 528 })).toEqual({
      bottom: "calc(0.5rem + 150px)",
      left: "439px",
      width: "528px",
    })
    expect(commandStripStyle({ lift: 150, center: 439, span: 900 }).width).toBe("640px")
  })

  test("the composer region doesn't write style onto the document root", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../pages/session/composer/session-composer-region.tsx"),
      "utf8",
    )
    expect(source).not.toContain("document.documentElement")
    expect(source).toContain("setCommandStripAnchor(")
  })
})
