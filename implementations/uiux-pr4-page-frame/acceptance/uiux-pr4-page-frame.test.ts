import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// PR4 of the UI/UX review (implementations/uiux-pr4-page-frame): one left edge and three heading levels.
const packages = path.resolve(import.meta.dir, "../..")
const read = (file: string) => readFileSync(path.join(packages, file), "utf8")

describe("page header", () => {
  // AC-1: a page whose content sits in a centred column puts its header in the same column.
  test("PageHeader can share the content column", () => {
    const page = read("app/src/components/page.tsx")
    expect(page).toMatch(/column\?: "narrow" \| "wide"/)
    expect(page).toContain("max-w-[720px]")
    expect(page).toContain("max-w-[1040px]")
  })

  test("column pages use it", () => {
    expect(read("app/src/pages/projects.tsx")).toMatch(/<PageHeader[\s\S]{0,200}column="narrow"/)
    const overview = read("app/src/pages/project-overview.tsx")
    expect(
      overview
        .split("<PageHeader")
        .slice(1)
        .every((part) => part.slice(0, 300).includes('column="wide"')),
    ).toBe(true)
    const notes = read("app/src/features/second-brain/notes-page.tsx")
    expect(
      notes
        .split("<PageHeader")
        .slice(1)
        .every((part) => part.slice(0, 400).includes('column="wide"')),
    ).toBe(true)
  })
})

describe("headings", () => {
  // AC-2: All projects separates a project (15/600) from its sections (11px caption, muted).
  test("project groups and their sections are different levels", () => {
    const overview = read("app/src/pages/project-overview.tsx")
    expect(overview).toMatch(/<h2 id=\{heading\(\)\} class="[^"]*type-toolbar-title/)
    const h3 = overview.match(/<h3 class="([^"]*)"/g) ?? []
    expect(h3.length).toBeGreaterThan(0)
    for (const tag of h3) {
      expect(tag).toContain("type-caption")
      expect(tag).toContain("uppercase")
      expect(tag).toContain("text-v2-text-text-muted")
    }
  })

  // AC-3: Settings section titles are not smaller than the 14px rows under them, and sit on the cards' edge.
  test("Settings section title is 14/600 without an inset", () => {
    const css = read("app/src/components/settings-v2/settings-v2.css")
    const block = css.slice(css.indexOf(".settings-v2-section-title {"))
    const rule = block.slice(0, block.indexOf("}"))
    expect(rule).toMatch(/font-size:\s*14px/)
    expect(rule).toMatch(/font-weight:\s*600/)
    expect(rule).not.toContain("padding-inline-start")
  })

  // AC-5: the create-project heading is a page title like every other page, not the 26px display style.
  test("create-project heading uses the page title role", () => {
    const details = read("app/src/features/second-brain/project-details.tsx")
    expect(details).toMatch(/id="project-create-title" class="[^"]*type-page-title/)
  })
})

describe("Settings edges", () => {
  // AC-4: header actions end on the cards' right edge (40px), not 24px short of it.
  test("Settings header uses the body's 40px sides", () => {
    const css = read("app/src/components/settings-v2/settings-v2.css")
    const block = css.slice(css.indexOf(".settings-v2-tab-header {"))
    expect(block.slice(0, block.indexOf("}"))).toMatch(/padding:\s*40px 40px 32px 40px/)
  })
})
