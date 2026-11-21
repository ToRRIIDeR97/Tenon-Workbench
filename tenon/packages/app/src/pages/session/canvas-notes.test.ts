import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { canvasNotes, notePosition } from "./canvas-notes"

const picked = (selector: string) => ({
  selector,
  tag: "button",
  text: "Get started",
  rect: { x: 10, y: 60, width: 100, height: 30 },
})

// #326: pins are numbered per design version, sent together, and kept (marked sent) as a record.
describe("AC-15 notes on a design's elements", () => {
  test("notes are numbered in order and kept per design", () => {
    const notes = canvasNotes()
    notes.add("design-1", picked("button.cta"), "Accent blue")
    notes.add("design-1", picked("h1"), "Shorter headline")
    notes.add("design-2", picked("p"), "Other design")
    expect(notes.list("design-1").map((note) => [note.number, note.selector, note.note])).toEqual([
      [1, "button.cta", "Accent blue"],
      [2, "h1", "Shorter headline"],
    ])
    expect(notes.list("design-2")).toHaveLength(1)
  })

  test("an empty note isn't added, and a note can be removed", () => {
    const notes = canvasNotes()
    notes.add("d", picked("a"), "   ")
    expect(notes.list("d")).toHaveLength(0)
    const id = notes.add("d", picked("a"), "Bigger")!
    notes.remove("d", id)
    expect(notes.list("d")).toHaveLength(0)
  })

  test("sending marks the pending notes sent and keeps them; new notes after that are pending", () => {
    const notes = canvasNotes()
    notes.add("d", picked("a"), "One")
    notes.add("d", picked("b"), "Two")
    const sent = notes.send("d")
    expect(sent.map((note) => note.note)).toEqual(["One", "Two"])
    expect(notes.list("d").every((note) => note.sent)).toBe(true)
    notes.add("d", picked("c"), "Three")
    expect(notes.pending("d").map((note) => [note.number, note.note])).toEqual([[3, "Three"]])
  })

  test("a pin follows the design as it scrolls", () => {
    expect(notePosition({ rect: { x: 10, y: 60, width: 100, height: 30 } }, { x: 0, y: 40 })).toEqual({ x: 110, y: 20 })
  })

  test("the large design uses the notes and the frame's inspect mode", () => {
    const source = readFileSync(join(import.meta.dir, "canvas-tab.tsx"), "utf8")
    expect(source).toContain("canvasNotes")
    expect(source).toContain("inspect={")
  })
})
