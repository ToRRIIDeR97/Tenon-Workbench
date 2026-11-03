import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { Glob } from "bun"

const app = path.resolve(import.meta.dir, "../../../../tenon/packages/app")
const src = path.join(app, "src")
const read = (file: string) => readFileSync(path.join(src, file), "utf8")
const sources = [...new Glob("**/*.{ts,tsx}").scanSync(src)].map((file) => ({ file, text: read(file) }))

describe("AC-1 dead code is gone", () => {
  test("AC-1 unused Home session list, project dialog and note client functions are removed", () => {
    for (const file of [
      "pages/home/home-sessions.tsx",
      "pages/home/home-sessions-view.tsx",
      "pages/home/home-scroll-controller.ts",
      "pages/home/home-session-search-controller.ts",
      "components/dialog-edit-project-v2.tsx",
      "components/edit-project.ts",
    ])
      expect(existsSync(path.join(src, file))).toBe(false)
    const client = read("features/second-brain/client.ts")
    for (const name of ["listNotes", "readNote", "writeNote", "deleteNote"])
      expect(client).not.toMatch(new RegExp(`export const ${name}\\b`))
  })

  test("AC-1 nothing imports a removed module", () => {
    const removed = ["home-sessions\"", "home-sessions-view", "home-scroll-controller", "home-session-search-controller", "dialog-edit-project-v2", "/edit-project\""]
    for (const source of sources) for (const name of removed) expect(`${source.file}: ${source.text.includes(name)}`).toBe(`${source.file}: false`)
  })
})

describe("AC-2 Home reuses the run-status helper", () => {
  test("AC-2 Home's running list uses agentRunStatus instead of its own status check", () => {
    const home = read("pages/brain-home.tsx")
    expect(home).toContain("agentRunStatus(")
    expect(home).not.toContain('!== "idle"')
  })
})

describe("AC-3 one sortable tab", () => {
  test("AC-3 the v1 tab, its solid-dnd branch and the solid-dnd dependency are gone", () => {
    expect(existsSync(path.join(src, "components/session/session-sortable-tab.tsx"))).toBe(false)
    expect(existsSync(path.join(src, "utils/solid-dnd.tsx"))).toBe(false)
    for (const source of sources) expect(`${source.file}: ${source.text.includes("@thisbeyond/solid-dnd")}`).toBe(`${source.file}: false`)
    expect(readFileSync(path.join(app, "package.json"), "utf8")).not.toContain("@thisbeyond/solid-dnd")
  })

  test("AC-3 FileVisual still exists for the v2 tab", () => {
    expect(read("components/session/session-sortable-tab-v2.tsx")).toContain("export function FileVisual")
  })
})

describe("AC-4 one new-thread view", () => {
  test("AC-4 the unreachable legacy NewSessionView is removed", () => {
    expect(existsSync(path.join(src, "components/session/session-new-view.tsx"))).toBe(false)
    expect(read("pages/session.tsx")).not.toContain("NewSessionView")
  })
})
