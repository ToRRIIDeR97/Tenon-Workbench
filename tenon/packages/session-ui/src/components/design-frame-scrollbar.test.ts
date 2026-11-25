import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { designDocument } from "./design-fence"

describe("AC-16 canvas frame scrollbar", () => {
  test("the frame document styles its scrollbar like the app, before the design's own styles", () => {
    const doc = designDocument("<style>body{color:red}</style><p>Hi</p>")
    expect(doc).toContain("::-webkit-scrollbar-thumb")
    expect(doc).toContain("border-radius:9999px")
    expect(doc.indexOf("::-webkit-scrollbar")).toBeLessThan(doc.indexOf("<style>body{color:red}</style>"))
  })
})

describe("AC-15 canvas rail button", () => {
  test("the rail always offers the canvas", () => {
    const rail = readFileSync(
      join(import.meta.dir, "..", "..", "..", "app", "src", "pages", "session", "session-side-rail.tsx"),
      "utf8",
    )
    expect(rail).toContain('section: "canvas"')
    expect(rail).not.toContain("props.canvas ||")
  })
})
