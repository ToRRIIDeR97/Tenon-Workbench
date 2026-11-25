import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { acceptsCover, coverSize } from "./project-cover-image"

describe("Project cover image", () => {
  test("keeps small images as they are and scales wide ones down to the cover width", () => {
    expect(coverSize(1600, 900)).toEqual({ width: 1600, height: 900 })
    expect(coverSize(4800, 1200)).toEqual({ width: 2400, height: 600 })
  })

  test("takes PNG, JPEG, WebP and GIF only", () => {
    expect(acceptsCover({ type: "image/png", size: 10 })).toBe(true)
    expect(acceptsCover({ type: "image/svg+xml", size: 10 })).toBe(false)
    expect(acceptsCover({ type: "image/jpeg", size: 0 })).toBe(false)
  })

  test("the Project page has a Back button and a cover menu on its cover band", () => {
    const view = readFileSync(join(import.meta.dir, "project-view.tsx"), "utf8")
    expect(view).toContain("data-project-back")
    expect(view).toContain("data-project-cover-menu")
    expect(view).toContain("card.cover.write(")
    const page = readFileSync(join(import.meta.dir, "../../pages/projects.tsx"), "utf8")
    expect(page).toContain('onBack={() => navigate("/projects")}')
  })
})
