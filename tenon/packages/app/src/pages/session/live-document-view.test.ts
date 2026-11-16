import { describe, expect, test } from "bun:test"
import { changedBlocks } from "./live-document"
import { blockOwners } from "./live-document-view"

// Rendered elements as the Markdown renderer shows them: syntax gone, one element per paragraph or heading.
const flashed = (before: string, after: string, rendered: string[]) => {
  const changed = new Set(changedBlocks(before, after))
  return blockOwners(rendered, after).flatMap((owner, index) => (changed.has(owner) ? [rendered[index]] : []))
}

describe("blockOwners", () => {
  test("a paragraph duplicated in place flashes the copy", () => {
    const before = "# T\n\nAlpha one.\n\nBeta two.\n\nGamma three.\n\nDelta four."
    const after = "# T\n\nAlpha one.\n\nAlpha one.\n\nBeta two.\n\nGamma three.\n\nDelta four."
    const rendered = ["T", "Alpha one.", "Alpha one.", "Beta two.", "Gamma three.", "Delta four."]
    expect(blockOwners(rendered, after)).toEqual([0, 1, 2, 3, 4, 5])
    expect(flashed(before, after, rendered)).toEqual(["Alpha one."])
  })

  test("a short paragraph after a longer one that contains it", () => {
    const before = "# T\n\nBanana bread.\n\nBread.\n\nOne.\n\nTwo."
    const after = "# T\n\nBanana bread.\n\nBan.\n\nOne.\n\nTwo."
    const rendered = ["T", "Banana bread.", "Ban.", "One.", "Two."]
    expect(blockOwners(rendered, after)).toEqual([0, 1, 2, 3, 4])
    expect(flashed(before, after, rendered)).toEqual(["Ban."])
  })

  test("several elements of one block, then the next block", () => {
    const after = "# T\n\n- one\n- two\n\nAfter."
    expect(blockOwners(["T", "one", "two", "After."], after)).toEqual([0, 1, 1, 2])
  })
})
