import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { githubTaskRows, type GithubWorkOk } from "./github-tasks"

// #331 (variant A): the repository's open issues are tasks; PRs hang under the issue they close.
const now = Date.parse("2026-11-19T00:00:00Z")
const issue = (number: number, state: "open" | "closed", updatedAt: string, title = `Issue ${number}`) => ({
  number,
  title,
  url: `u${number}`,
  state,
  updatedAt,
  closedAt: state === "closed" ? updatedAt : undefined,
  author: "me",
  labels: [],
})
const failing = {
  number: 88,
  title: "Fix",
  url: "p88",
  state: "open" as const,
  draft: false,
  checks: "failing" as const,
  review: "required" as const,
  closes: [84],
}
const work: GithubWorkOk = {
  status: "ok",
  repo: "o/r",
  issues: [
    issue(84, "open", "2026-11-18T10:00:00Z"),
    issue(85, "open", "2026-11-18T11:00:00Z"),
    issue(86, "closed", "2026-11-18T09:00:00Z"),
    issue(70, "closed", "2026-10-01T09:00:00Z"),
  ],
  pulls: [
    failing,
    {
      number: 87,
      title: "Rollback",
      url: "p87",
      state: "merged",
      draft: false,
      checks: "passing",
      review: "approved",
      closes: [86],
    },
  ],
}

describe("AC-20 GitHub issues as tasks", () => {
  test("open issues are tasks, newest first, each with the PR that closes it", () => {
    const rows = githubTaskRows(work, "open", now)
    expect(rows.map((row) => [row.number, row.done, row.status, row.pulls.map((pull) => pull.number)])).toEqual([
      [85, false, undefined, []],
      [84, false, "checks-failing", [88]],
    ])
  })

  test("All also shows issues closed in the last two weeks, done, with the PR that merged", () => {
    const rows = githubTaskRows(work, "all", now)
    expect(rows.map((row) => [row.number, row.done, row.status])).toEqual([
      [85, false, undefined],
      [84, false, "checks-failing"],
      [86, true, "merged"],
    ])
  })

  test("a PR in review with passing checks reads as in review; a draft as draft", () => {
    const review = githubTaskRows({ ...work, pulls: [{ ...failing, checks: "passing" }] }, "open", now).find(
      (row) => row.number === 84,
    )
    expect(review?.status).toBe("in-review")
    const draft = githubTaskRows({ ...work, pulls: [{ ...failing, draft: true }] }, "open", now).find(
      (row) => row.number === 84,
    )
    expect(draft?.status).toBe("draft")
  })

  test("the Project's Tasks list shows the GitHub rows", () => {
    const source = readFileSync(join(import.meta.dir, "project-view.tsx"), "utf8")
    expect(source).toContain("ProjectGithubTasks")
  })
})
