import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { githubTaskRows, linkedIssueNumbers, type GithubWorkOk } from "./github-tasks"

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

  test("an issue a Tenon task mirrors with (#N) is left out of the GitHub rows", () => {
    const linked = linkedIssueNumbers(["Fix login redirect (#84)", "Plan v2", "Mentions #85 midway"])
    expect([...linked]).toEqual([84])
    expect(githubTaskRows(work, "open", now, linked).map((row) => row.number)).toEqual([85])
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

describe("AC-12 GitHub task rows and threads", () => {
  test("a row carries the thread of the PR it shows", () => {
    const traced: GithubWorkOk = {
      status: "ok",
      repo: "o/r",
      issues: [issue(5, "closed", "2026-11-18T00:00:00Z")],
      pulls: [
        {
          number: 12,
          title: "Fix",
          url: "p12",
          state: "merged",
          draft: false,
          closes: [5],
          thread: { id: "ses_a", title: "Fix login" },
        },
      ],
    }
    expect(githubTaskRows(traced, "all", now)[0]?.thread).toEqual({ id: "ses_a", title: "Fix login" })
  })

  test("a row whose PR has no known thread has none", () => {
    expect(githubTaskRows(work, "open", now).every((row) => row.thread === undefined)).toBe(true)
  })

  test("the task item opens the PR's thread", () => {
    const view = readFileSync(join(import.meta.dir, "project-github-tasks.tsx"), "utf8")
    expect(view).toContain('data-action="github-task-thread"')
    expect(view).toContain("secondBrain.github.fromThread")
  })
})

describe("AC-12b PRs that close no issue", () => {
  const standalone = (number: number, state: "open" | "merged" | "closed", thread?: { id: string; title: string }) => ({
    number,
    title: `PR ${number}`,
    url: `p${number}`,
    state,
    draft: false,
    closes: [] as number[],
    ...(thread ? { thread } : {}),
  })

  test("an open PR that closes no issue is a row of its own, with its thread", () => {
    const rows = githubTaskRows(
      { ...work, pulls: [...work.pulls, standalone(90, "open", { id: "ses_x", title: "X" })] },
      "open",
      now,
    )
    const row = rows.find((item) => item.number === 90)
    expect(row).toMatchObject({ kind: "pull", done: false, status: "in-review", thread: { id: "ses_x", title: "X" } })
    expect(rows.filter((item) => item.kind === "issue").map((item) => item.number)).toEqual([85, 84])
  })

  test("a merged one shows under All as done, not under Open", () => {
    const merged = { ...work, pulls: [...work.pulls, standalone(91, "merged", { id: "ses_m", title: "M" })] }
    expect(githubTaskRows(merged, "open", now).some((item) => item.number === 91)).toBe(false)
    expect(githubTaskRows(merged, "all", now).find((item) => item.number === 91)).toMatchObject({
      kind: "pull",
      done: true,
      status: "merged",
      thread: { id: "ses_m", title: "M" },
    })
  })

  test("like issues, done PRs show under All only for two weeks", () => {
    const old = { ...standalone(92, "merged"), closedAt: "2026-10-01T00:00:00Z" }
    const recent = { ...standalone(93, "merged"), closedAt: "2026-11-17T00:00:00Z" }
    const rows = githubTaskRows({ ...work, pulls: [...work.pulls, old, recent] }, "all", now)
    expect(rows.some((item) => item.number === 92)).toBe(false)
    expect(rows.some((item) => item.number === 93)).toBe(true)
  })

  test("a PR that closes a listed issue stays under that issue, not on its own", () => {
    expect(githubTaskRows(work, "all", now).filter((item) => item.kind === "pull")).toEqual([])
  })
})
