import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { Glob } from "bun"
import { projectTabs } from "../../../../tenon/packages/app/src/features/second-brain/notes-project"

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

describe("AC-2 and AC-3 one page", () => {
  test("AC-2 the old Notes page is gone and /projects is the merged page", () => {
    expect(existsSync(path.join(src, "pages/notes.tsx"))).toBe(false)
    const page = read("pages/projects.tsx")
    expect(page).toContain("<NotesTree")
    expect(page).toContain("<ProjectDetails")
    expect(page).toContain("<ProjectCreate")
  })

  test("AC-2 the tree has Projects, a folded Archived group and General", () => {
    const tree = read("features/second-brain/notes-tree.tsx")
    expect(tree).toContain('"group:archived": true')
    expect(tree).toContain('language.t("secondBrain.vault.general")')
  })

  test("AC-3 a Project has a Details tab after its other views", () => {
    expect([...projectTabs]).toEqual(["timeline", "board", "table", "calendar", "docs", "log", "details"])
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
