import { expect, test } from "bun:test"
import { seedWorkspaces, threadDirectories } from "./companion"

test("the computer's thread folders become the phone's workspaces once, newest first", () => {
  const answer = {
    data: [
      { id: "a", directory: "C:\\Users\\me\\work" },
      { id: "b", directory: "C:\\Users\\me\\notes" },
      { id: "c", directory: "C:\\Users\\me\\work" },
      { id: "d" },
      { id: "e", location: { directory: "C:\\Users\\me\\v2" } },
    ],
  }
  expect(threadDirectories(answer)).toEqual(["C:\\Users\\me\\work", "C:\\Users\\me\\notes", "C:\\Users\\me\\v2"])
  expect(threadDirectories({ data: "nope" })).toEqual([])
  const seeded = seedWorkspaces(null, threadDirectories(answer))
  expect(JSON.parse(seeded!)).toEqual({
    projects: {
      local: [
        { worktree: "C:\\Users\\me\\work", expanded: true },
        { worktree: "C:\\Users\\me\\notes", expanded: true },
        { worktree: "C:\\Users\\me\\v2", expanded: true },
      ],
    },
  })
  expect(seedWorkspaces(seeded!, ["D:\\other"])).toBeUndefined()
  expect(seedWorkspaces(null, [])).toBeUndefined()
  expect(JSON.parse(seedWorkspaces("{broken", ["/srv/a"])!)).toEqual({
    projects: { local: [{ worktree: "/srv/a", expanded: true }] },
  })
})
