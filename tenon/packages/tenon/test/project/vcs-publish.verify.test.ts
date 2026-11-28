import { describe, expect, test } from "bun:test"
import { VcsPublish } from "../../src/project/vcs-publish"

describe("AC-22/AC-24 (verification)", () => {
  test("a base branch that looks like an option is refused", () => {
    expect(() => VcsPublish.prCreateArgs({ title: "T", body: "", base: "--web", draft: false })).toThrow()
  })

  test("a title made only of symbols still gives a valid suggestion", () => {
    const name = VcsPublish.branchFromTitle("!!! ???")
    expect(VcsPublish.validBranchName(name)).toBe(true)
  })

  test("a long title is cut to a reasonable branch name", () => {
    const name = VcsPublish.branchFromTitle("word ".repeat(40))
    expect(name.length).toBeLessThanOrEqual(60)
    expect(VcsPublish.validBranchName(name)).toBe(true)
  })

  test("a GitHub Enterprise URL is read too, and the last URL wins", () => {
    expect(VcsPublish.prUrl("https://github.example.com/a/b/pull/1\nhttps://github.example.com/a/b/pull/2")).toBe(
      "https://github.example.com/a/b/pull/2",
    )
  })

  test("control characters are not allowed in branch names", () => {
    expect(VcsPublish.validBranchName("a\u0007b")).toBe(false)
  })
})
