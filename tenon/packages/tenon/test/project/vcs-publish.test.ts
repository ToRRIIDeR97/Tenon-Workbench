import { describe, expect, test } from "bun:test"
import { VcsPublish } from "../../src/project/vcs-publish"

describe("AC-22 branch names", () => {
  test("accepts ordinary branch names", () => {
    for (const name of ["feature/login", "fix-123", "tenon/turn-undo", "a.b"])
      expect(VcsPublish.validBranchName(name)).toBe(true)
  })

  test("rejects what git refuses or would read as an option", () => {
    for (const name of [
      "",
      "-x",
      "--orphan=x",
      "a b",
      "a..b",
      "a~1",
      "a^",
      "a:b",
      "a?",
      "a*",
      "a[",
      "a\\b",
      "a/",
      "/a",
      "a.lock",
      "a.",
      "a@{1}",
      "a//b",
      "@",
    ])
      expect(VcsPublish.validBranchName(name)).toBe(false)
  })

  test("a branch suggestion comes from the title", () => {
    expect(VcsPublish.branchFromTitle("Fix the Login bug!")).toBe("tenon/fix-the-login-bug")
    expect(VcsPublish.branchFromTitle("")).toBe("tenon/changes")
  })
})

describe("AC-24 pull request arguments", () => {
  test("builds gh arguments without a shell", () => {
    expect(VcsPublish.prCreateArgs({ title: "Add $(rm -rf) title", body: "Body; echo", draft: false })).toEqual([
      "pr",
      "create",
      "--title",
      "Add $(rm -rf) title",
      "--body",
      "Body; echo",
    ])
    expect(VcsPublish.prCreateArgs({ title: "T", body: "", base: "main", draft: true })).toEqual([
      "pr",
      "create",
      "--title",
      "T",
      "--body",
      "",
      "--base",
      "main",
      "--draft",
    ])
  })

  test("reads the PR URL from gh output", () => {
    expect(VcsPublish.prUrl("Creating pull request for x into main\n\nhttps://github.com/acme/api/pull/42\n")).toBe(
      "https://github.com/acme/api/pull/42",
    )
    expect(VcsPublish.prUrl("no url")).toBeUndefined()
  })
})
