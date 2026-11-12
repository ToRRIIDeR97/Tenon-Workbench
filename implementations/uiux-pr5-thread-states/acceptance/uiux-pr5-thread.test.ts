import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// PR5 of the UI/UX review (implementations/uiux-pr5-thread-states): calmer, clearer thread states.
const packages = path.resolve(import.meta.dir, "../..")
const read = (file: string) => readFileSync(path.join(packages, file), "utf8")
const rule = (css: string, selector: string) => {
  const start = css.indexOf(selector)
  return start < 0 ? "" : css.slice(start, css.indexOf("}", start))
}

describe("steps", () => {
  const summary = read("app/src/components/session/turn-steps-summary.tsx")
  const css = read("app/src/components/session/turn-steps-summary.css")

  // AC-1: a reasoning note renders its markdown instead of showing raw **asterisks**.
  test("reasoning note renders markdown", () => {
    // Loaded lazily: a static import pulls the renderer's worker into every importer, including `bun test`.
    expect(summary).toMatch(/import\("@tenon\/session-ui\/markdown"\)/)
    const note = summary.slice(summary.indexOf('data-slot="turn-steps-note-text"'))
    expect(note.slice(0, 300)).toMatch(/<Markdown\b/)
  })

  // AC-3: rows layout keeps one 32px row height, running or not, with a soft fill instead of the accent block.
  test("running row keeps the row height and a soft fill", () => {
    const rows = css.slice(css.indexOf('[data-slot="turn-steps"][data-layout="rows"]'))
    const idle = rule(rows, '[data-slot="turn-steps-note"] {')
    expect(idle).toMatch(/min-height:\s*32px/)
    const running = rule(rows, '[data-slot="turn-steps-note"][data-running] {')
    expect(running).toMatch(/min-height:\s*32px/)
    expect(running).not.toContain("bg-accent-container")
    expect(running).toContain("--v2-background-bg-layer-02")
  })

  // AC-5: a finished subagent lane no longer looks like a running one (quiet bar, not the accent).
  test("finished lane bar is quiet", () => {
    expect(css).toMatch(
      /\[data-slot="turn-steps-lane"\]\[data-status="done"\] \[data-slot="turn-steps-lane-fill"\]\s*\{[^}]*--v2-border-border-strong/,
    )
  })

  // AC-6: the polite live region doesn't announce a ticking clock.
  test("ticker timers are hidden from the live region", () => {
    const timers =
      summary.match(/<span class="shrink-0 tabular-nums text-v2-text-text-muted"[^>]*>\s*\{time\(\)\}\s*<\/span>/g) ?? []
    expect(timers.length).toBe(2)
    for (const timer of timers) expect(timer).toContain('aria-hidden="true"')
  })
})

describe("diff counts", () => {
  // AC-2: a side with nothing changed is left out, and the counts use the v2 state colours.
  test("zero sides are omitted and colours are v2 tokens", () => {
    const tsx = read("ui/src/components/diff-changes.tsx")
    expect(tsx).toMatch(/<Show when=\{additions\(\) > 0\}>/)
    expect(tsx).toMatch(/<Show when=\{deletions\(\) > 0\}>/)
    const css = read("ui/src/components/diff-changes.css")
    expect(rule(css, '[data-slot="diff-changes-additions"] {')).toContain("var(--v2-state-fg-success)")
    expect(rule(css, '[data-slot="diff-changes-deletions"] {')).toContain("var(--v2-state-fg-danger)")
  })
})

describe("markdown and review", () => {
  // AC-4: markdown tables fill the column and quotes have a visible rule.
  test("tables fill the width; quotes have a 3px rule", () => {
    const css = read("session-ui/src/components/markdown.css")
    const table = rule(css, "  table {")
    expect(table).toMatch(/display:\s*table/)
    expect(table).toMatch(/width:\s*100%/)
    expect(rule(css, "  blockquote {")).toMatch(/border-inline-start:\s*3px/)
  })

  // AC-7: the review toolbar's position count uses the muted text token, not a raw grey.
  test("review position uses muted text", () => {
    expect(read("session-ui/src/v2/components/session-review-v2.css")).not.toContain("color: var(--v2-grey-600)")
  })
})
