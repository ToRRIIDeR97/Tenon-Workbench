import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const packages = path.resolve(import.meta.dir, "../..")
const read = (file: string) => readFileSync(path.join(packages, file), "utf8")

describe("dock cards", () => {
  test("question dock uses the approval card shell", () => {
    const css = read("session-ui/src/components/message-part.css")
    const block = css.slice(css.indexOf('[data-component="dock-prompt"][data-kind="question"] {'))
    const own = block.slice(0, block.indexOf("[data-slot"))
    expect(own).toMatch(/border-radius:\s*var\(--v2-radius-xl\)/)
    expect(own).toMatch(/background(-color)?:\s*var\(--v2-background-bg-base\)/)
    expect(own).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--v2-border-border-muted\)/)
    expect(css).toMatch(/\[data-kind="question"\]\s*>\s*\[data-dock-surface\]\s*\{[^}]*box-shadow:\s*none/)
    const dock = read("app/src/pages/session/composer/session-question-dock.tsx")
    expect(dock).not.toContain('size="large"')
  })
})

describe("approval card", () => {
  const dock = read("app/src/pages/session/composer/session-permission-dock.tsx")
  const split = dock.slice(dock.indexOf("function SplitButton"))

  test("split button is one pill", () => {
    expect(split).toMatch(/class="[^"]*rounded-full[^"]*overflow-hidden/)
    expect(split).not.toContain("gap-px")
    expect(split).not.toContain("9999px 4px 4px 9999px")
    expect(split).not.toContain("4px 9999px 9999px 4px")
    expect(split.match(/focus-visible:!outline-offset-\[-2px\]/g)?.length).toBeGreaterThanOrEqual(2)
  })

  test("deny-reason field is a 28px pill", () => {
    const input = dock.slice(dock.indexOf("<input"), dock.indexOf("/>", dock.indexOf("<input")))
    expect(input).toMatch(/class="[^"]*\bh-7\b[^"]*rounded-full/)
  })
})

describe("one recipe per control", () => {
  test("Home uses the shared meter for both bars", () => {
    const home = read("app/src/pages/brain-home.tsx")
    expect(home).not.toMatch(/class="h-1(\.5)? [^"]*overflow-hidden rounded-full bg-v2-background-bg-layer/)
    expect(home.match(/<Meter\b/g)?.length).toBe(2)
  })

  test("page properties use a switch for booleans", () => {
    const notes = read("app/src/features/second-brain/notes-page.tsx")
    expect(notes).not.toContain("CheckboxV2")
  })

  test("list switches are small", () => {
    const models = read("app/src/components/settings-v2/models.tsx")
    const rows = models.slice(models.indexOf("<For each={group.items}>"))
    expect(rows.slice(0, rows.indexOf("</Switch>"))).toContain('size="small"')
    const skills = read("app/src/components/settings-v2/skills.tsx")
    const toggle = skills.slice(skills.indexOf("<ToggleSwitch"))
    expect(toggle.slice(0, toggle.indexOf(">"))).toContain('size="small"')
  })
})
