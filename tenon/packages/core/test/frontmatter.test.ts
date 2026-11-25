import { describe, expect, test } from "bun:test"
import { Frontmatter } from "../src/frontmatter"

describe("Frontmatter", () => {
  test("reads front matter behind a UTF-8 byte order mark", () => {
    expect(Frontmatter.parse("﻿---\ntitle: Kept\n---\nbody").data).toEqual({ title: "Kept" })
  })

  test("refuses YAML alias bombs before expanding them", () => {
    const lines = ["a: &a [x, x, x, x, x, x, x, x, x, x]"]
    for (let i = 0; i < 30; i++) lines.push(`k${i}: [*a, *a]`)
    expect(() => Frontmatter.parse(`---\n${lines.join("\n")}\n---\nbody`)).toThrow("too_many_aliases")
    expect(Frontmatter.parse("---\nbase: &b 1\ncopy: *b\nnote: '5 * 3'\n---\n*emphasis*").data).toEqual({
      base: 1,
      copy: 1,
      note: "5 * 3",
    })
  })

  test("never evaluates JavaScript front matter, when reading or writing", () => {
    const code = "---js\nglobalThis.__tenonFrontmatterRan = true; ({ a: 1 })\n---\nbody"
    expect(() => Frontmatter.parse(code)).toThrow("javascript_disabled")
    const written = Frontmatter.stringify(code, { title: "T" })
    expect((globalThis as { __tenonFrontmatterRan?: boolean }).__tenonFrontmatterRan).toBeUndefined()
    expect(written).toBe(`---\ntitle: T\n---\n${code}\n`)
  })
})
