import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Acceptance test for implementations/harness-ux-batch-2 (AC-4), by inspection: running is a breathing blue dot.

const src = join(import.meta.dir, "..", "..")
const read = (path: string) => readFileSync(join(src, path), "utf8")

describe("AC-4 breathing running dot", () => {
  test(".running-pulse breathes in and out and rests under reduced motion", () => {
    const css = read("index.css")
    const rule = css.slice(css.indexOf(".running-pulse"), css.indexOf("@keyframes running-breathe"))
    expect(rule).toContain("running-breathe")
    expect(rule).toContain("infinite")
    const frames = css.slice(css.indexOf("@keyframes running-breathe"))
    expect(frames).toContain("scale(")
    expect(frames).toContain("opacity")
    expect(frames.slice(0, frames.indexOf("@media"))).toContain("50%")
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.running-pulse[^}]*animation: none/)
  })

  test("the thread's Working row shows the dot instead of a spinner", () => {
    const row = read("components/session/turn-steps-summary.tsx")
    expect(row).toContain("running-pulse")
    expect(row).not.toContain("<LoaderV2")
  })

  test("the sidebar's running mark breathes", () => {
    const sidebar = read("components/second-brain-sidebar.tsx")
    const mark = sidebar.slice(sidebar.indexOf('data-sidebar-status="running"'))
    expect(mark.slice(0, 200)).toContain("running-pulse")
  })
})
