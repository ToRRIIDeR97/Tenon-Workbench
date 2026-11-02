import { describe, expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { editDiffs } from "./step-diff"

const tool = (name: string, input: Record<string, unknown>, metadata: Record<string, unknown> = {}) =>
  ({
    id: "t1",
    type: "tool",
    tool: name,
    state: { status: "completed", input, metadata, output: "Edit applied successfully.", time: { start: 1, end: 2 } },
  }) as unknown as ToolPart

describe("editDiffs", () => {
  test("reads a harness edit's old and new text and counts its lines", () => {
    const [diff] = editDiffs(
      tool("edit", {}, { filediff: { file: "src/a.ts", before: "one\ntwo\n", after: "one\nthree\nfour\n" } }),
    )
    expect(diff).toMatchObject({ file: "src/a.ts", additions: 2, deletions: 1 })
  })

  test("keeps the counts the edit reported", () => {
    const [diff] = editDiffs(
      tool(
        "edit",
        { filePath: "src/a.ts", oldString: "a", newString: "b" },
        { filediff: { additions: 4, deletions: 3 } },
      ),
    )
    expect(diff).toMatchObject({ file: "src/a.ts", additions: 4, deletions: 3 })
  })

  test("shows a written file as all added", () => {
    expect(editDiffs(tool("write", { filePath: "notes.md", content: "a\nb\n" }))).toMatchObject([
      { file: "notes.md", additions: 2, deletions: 0 },
    ])
  })

  test("lists each file of a patch", () => {
    const files = [
      { relativePath: "a.ts", before: "x\n", after: "y\n" },
      { relativePath: "b.ts", before: "", after: "z\n" },
    ]
    expect(editDiffs(tool("apply_patch", {}, { files })).map((diff) => diff.file)).toEqual(["a.ts", "b.ts"])
  })

  test("has nothing for other tools or unfinished edits", () => {
    expect(editDiffs(tool("bash", { command: "ls" }))).toEqual([])
    const running = { ...tool("edit", { filePath: "a", oldString: "a", newString: "b" }), state: { status: "running" } }
    expect(editDiffs(running as unknown as ToolPart)).toEqual([])
  })
})
