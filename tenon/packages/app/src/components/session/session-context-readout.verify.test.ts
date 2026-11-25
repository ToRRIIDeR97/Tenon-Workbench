import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const read = (file: string) => readFileSync(path.join(import.meta.dir, file), "utf8")

describe("context surfaces read one readout", () => {
  test("the ring and the context menu use contextReadout", () => {
    const strip = read("../prompt-input/context-strip.tsx")
    expect(strip).toContain("contextReadout(")
    expect(strip).not.toMatch(/value\.usage === null/)
  })

  test("the Context tab uses contextReadout and never formats a null share", () => {
    const tab = read("./session-context-tab.tsx")
    expect(tab).toContain("contextReadout(")
    expect(tab).not.toContain("formatter().percent(ctx()?.usage)")
    expect(tab).not.toMatch(/c\?\.limit\s*\?\s*language\.t\("secondBrain\.sessionTab\.contextUsed"/)
  })
})
