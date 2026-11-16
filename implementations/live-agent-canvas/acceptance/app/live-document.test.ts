import { describe, expect, test } from "bun:test"
import { changedBlocks, liveWrites, markdownBlocks } from "../../../../tenon/packages/app/src/pages/session/live-document"

const tool = (callID: string, name: string, status: string, input: Record<string, unknown>) => ({
  id: callID,
  type: "tool",
  tool: name,
  callID,
  state: { status, input },
})

// AC-15: the file operations the agent is making, live.
describe("AC-15 liveWrites", () => {
  test("write and edit calls with a path, in order", () => {
    const writes = liveWrites([
      tool("c1", "write", "completed", { filePath: "docs/a.md", content: "# A" }),
      tool("c2", "edit", "pending", { filePath: "docs/a.md", oldString: "A", newString: "B" }),
      tool("c3", "bash", "running", { command: "ls" }),
      tool("c4", "write", "pending", {}),
    ])
    expect(writes).toEqual([
      { callID: "c1", tool: "write", path: "docs/a.md", status: "completed", content: "# A" },
      { callID: "c2", tool: "edit", path: "docs/a.md", status: "streaming", oldString: "A", newString: "B" },
    ])
  })
})

// AC-16: Markdown splits into blocks; a fenced code block stays whole.
describe("AC-16 markdownBlocks", () => {
  test("blank lines separate blocks", () => {
    expect(markdownBlocks("# T\n\nOne\ntwo\n\n```js\na\n\nb\n```\n\n- x")).toEqual(["# T", "One\ntwo", "```js\na\n\nb\n```", "- x"])
  })
})

// AC-17: only blocks that changed flash, and a rewrite of most of the file flashes nothing.
describe("AC-17 changedBlocks", () => {
  const before = "# Plan\n\n## Goals\n\nShip it.\n\n## Risks\n\nNone."
  test("one paragraph edited", () => {
    expect(changedBlocks(before, before.replace("Ship it.", "Ship it soon."))).toEqual([2])
  })
  test("a block inserted", () => {
    expect(changedBlocks(before, before.replace("## Risks", "New idea.\n\n## Risks"))).toEqual([3])
  })
  test("first write flashes nothing", () => expect(changedBlocks("", before)).toEqual([]))
  test("more than half changed flashes nothing", () => {
    expect(changedBlocks(before, "# Other\n\n## A\n\nB\n\n## Risks\n\nNone.")).toEqual([])
  })
})
