import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// Verification for #329 (plan author's check): the card wires the pill, the thread switcher and the shortcut, and
// `send()` routes through `promptRoute`.
const read = (file: string) => readFileSync(path.join(import.meta.dir, file), "utf8")

describe("command card wiring", () => {
  const strip = read("command-strip.tsx")

  test("AC-9 the card shows the pill for a new thread and the thread's harness for a reply", () => {
    expect(strip).toContain("<ComposerModelPill")
    expect(strip).toContain("createComposerHarness(")
    expect(strip).toContain('data-slot="command-card-runs-on"')
  })

  test("AC-9 the card switches the thread it replies to", () => {
    expect(strip).toContain("stripTarget(")
    expect(strip).toContain('data-action="command-card-threads"')
  })

  test("AC-9 the card shows its shortcut", () => {
    expect(strip).toContain("formatKeybind(")
  })

  test("AC-8 send routes a reply through its thread's harness", () => {
    const centre = read("command-centre.tsx")
    expect(centre).toContain("promptRoute(")
  })
})
