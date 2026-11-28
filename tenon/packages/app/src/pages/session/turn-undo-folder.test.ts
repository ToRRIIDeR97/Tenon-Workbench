import { describe, expect, test } from "bun:test"
import { folderPrefix, turnUndoPlan } from "./turn-undo"

describe("AC-28 undo turn in a folder below the repository root", () => {
  test("the prefix is the folder's path inside the worktree", () => {
    expect(folderPrefix("/repo", "/repo")).toBe("")
    expect(folderPrefix("/repo", "/repo/sub")).toBe("sub/")
    expect(folderPrefix("/repo/", "/repo/sub/deep/")).toBe("sub/deep/")
    expect(folderPrefix("C:\\Code\\Repo", "c:\\code\\repo\\Sub")).toBe("Sub/")
    expect(folderPrefix("/", "/anything")).toBe("")
    expect(folderPrefix(undefined, "/repo/sub")).toBe("")
    expect(folderPrefix("/repo", "/repository")).toBe("")
    expect(folderPrefix("/repo", "/other")).toBe("")
  })

  test("repository paths are rebased onto the folder and the rest are skipped", () => {
    const plan = turnUndoPlan({
      prefix: "sub/",
      writes: [],
      diffs: [
        { file: "sub/a.txt", patch: "p1", status: "modified", additions: 1, deletions: 1 },
        { file: "sub/new/x.txt", patch: "p2", status: "deleted", additions: 0, deletions: 1 },
        { file: "other/b.txt", patch: "p3", status: "added", additions: 1, deletions: 0 },
        { file: "subway.txt", patch: "p4", status: "added", additions: 1, deletions: 0 },
      ],
    })
    expect(plan.files).toEqual([
      { file: "a.txt", patch: "p1", status: "modified" },
      { file: "new/x.txt", patch: "p2", status: "deleted" },
    ])
    expect(plan.skipped).toEqual(["other/b.txt", "subway.txt"])
  })
})
