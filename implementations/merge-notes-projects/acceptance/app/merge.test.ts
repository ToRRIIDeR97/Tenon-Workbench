import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { Glob } from "bun"

const src = path.resolve(import.meta.dir, "../../../../tenon/packages/app/src")
const read = (file: string) => readFileSync(path.join(src, file), "utf8")
const sources = [...new Glob("**/*.{ts,tsx}").scanSync(src)]
  .filter((file) => !file.endsWith(".test.ts"))
  .map((file) => ({ file, text: read(file) }))

describe("AC-1 one rail item", () => {
  test("AC-1 the rail has Projects at /projects and no Notes item", () => {
    const sidebar = read("components/second-brain-sidebar.tsx")
    expect(sidebar).toContain('{ id: "projects", icon: "book" as const, label: language.t("secondBrain.sidebar.projects"), href: "/projects" }')
    expect(sidebar).not.toContain('id: "notes"')
  })
})

// AC-2 (the tree) and AC-3 (the tabs) were superseded by Implementations/projects-one-page/ (workshop variant B):
// the page has no tree, and a Project is one page with sections. Its own checks cover them.
describe("AC-2 one page", () => {
  test("AC-2 the old Notes page is gone and /projects is the merged page", () => {
    expect(existsSync(path.join(src, "pages/notes.tsx"))).toBe(false)
    const page = read("pages/projects.tsx")
    expect(page).toContain("<ProjectDetails")
    expect(page).toContain("<ProjectCreate")
  })
})

describe("AC-5 redirects and links", () => {
  test("AC-5 /notes redirects to /projects with its query", () => {
    const app = read("app.tsx")
    expect(app).toContain('<Route path="/notes" component={NotesRedirect} />')
    expect(app).toContain("<Navigate href={`/projects${location.search}`} />")
  })

  test("AC-5 no in-app link points at /notes any more", () => {
    // The redirect route and the wiki-link click handler name /notes on purpose.
    const allowed = (line: string) =>
      line.includes('<Route path="/notes"') ||
      line.includes('url.pathname !== "/notes"') ||
      /^\s*(\*|\/\/)/.test(line)
    for (const source of sources) {
      const lines = source.text.split("\n").filter((line) => !allowed(line))
      const links = lines.join("\n").match(/[`"']\/notes[?"'`]/g) ?? []
      expect(`${source.file}: ${links.length}`).toBe(`${source.file}: 0`)
    }
  })
})
