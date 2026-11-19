import { describe, expect, test } from "bun:test"
import { GithubWork } from "@tenon/core/github/work"

// #331: a Project's GitHub work, read through the user's own `gh` login.
const issuesJson = JSON.stringify([
  {
    number: 84,
    title: "Fix login redirect loop",
    url: "https://github.com/o/r/issues/84",
    state: "OPEN",
    updatedAt: "2026-11-18T10:00:00Z",
    closedAt: null,
    labels: [{ name: "bug" }],
    author: { login: "codex-bot" },
  },
  {
    number: 86,
    title: "Add rollback script",
    url: "https://github.com/o/r/issues/86",
    state: "CLOSED",
    updatedAt: "2026-11-18T09:00:00Z",
    closedAt: "2026-11-18T09:00:00Z",
    labels: [],
    author: { login: "me" },
  },
])
const pullsJson = JSON.stringify([
  {
    number: 88,
    title: "Fix the redirect",
    url: "https://github.com/o/r/pull/88",
    state: "OPEN",
    isDraft: false,
    mergedAt: null,
    reviewDecision: "REVIEW_REQUIRED",
    closingIssuesReferences: [{ number: 84 }],
    statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }],
  },
  {
    number: 87,
    title: "Rollback script",
    url: "https://github.com/o/r/pull/87",
    state: "MERGED",
    isDraft: false,
    mergedAt: "2026-11-18T09:00:00Z",
    reviewDecision: "APPROVED",
    closingIssuesReferences: [{ number: 86 }],
    statusCheckRollup: [{ conclusion: "SUCCESS" }],
  },
])

type Call = { command: string; args: string[] }
const runner =
  (answers: Record<string, string | Error>, calls: Call[] = []) =>
  async (command: string, args: string[]) => {
    calls.push({ command, args })
    const answer = answers[`${command} ${args[0]}`] ?? answers[command]
    if (answer instanceof Error) throw answer
    if (answer === undefined) throw new Error(`unexpected ${command} ${args[0]}`)
    return answer
  }

describe("AC-19 the repository behind a Project folder", () => {
  test("GitHub remotes in https, ssh and scp form name owner/repo", () => {
    expect(GithubWork.repoFromRemote("https://github.com/ToRRIIDeR97/Tenon-Workbench.git")).toBe(
      "ToRRIIDeR97/Tenon-Workbench",
    )
    expect(GithubWork.repoFromRemote("git@github.com:o/r.git\n")).toBe("o/r")
    expect(GithubWork.repoFromRemote("ssh://git@github.com/o/r")).toBe("o/r")
    expect(GithubWork.repoFromRemote("https://gitlab.com/o/r.git")).toBeUndefined()
  })

  test("only a plain owner/repo is accepted as an override", () => {
    expect(GithubWork.validRepo("o/r")).toBe(true)
    expect(GithubWork.validRepo("o/r; rm -rf /")).toBe(false)
    expect(GithubWork.validRepo("--repo=x/y")).toBe(false)
  })
})

describe("AC-19 reading issues and PRs with gh", () => {
  test("issues and PRs come back with the states that matter", async () => {
    const calls: Call[] = []
    const work = await GithubWork.read({
      directory: "/p",
      gh: "gh",
      run: runner({ git: "https://github.com/o/r.git\n", "gh issue": issuesJson, "gh pr": pullsJson }, calls),
    })
    expect(work.status).toBe("ok")
    if (work.status !== "ok") return
    expect(work.repo).toBe("o/r")
    expect(work.issues.map((issue) => [issue.number, issue.state, issue.author])).toEqual([
      [84, "open", "codex-bot"],
      [86, "closed", "me"],
    ])
    expect(work.pulls.map((pull) => [pull.number, pull.state, pull.checks, pull.review, pull.closes])).toEqual([
      [88, "open", "failing", "required", [84]],
      [87, "merged", "passing", "approved", [86]],
    ])
    expect(calls.find((call) => call.args[0] === "issue")?.args).toContain("--repo")
  })

  test("a folder without a GitHub origin, a missing gh and a signed-out gh each say so", async () => {
    expect(
      (await GithubWork.read({ directory: "/p", gh: "gh", run: runner({ git: new Error("no origin") }) })).status,
    ).toBe("no-repo")
    expect(
      (await GithubWork.read({ directory: "/p", gh: undefined, run: runner({ git: "git@github.com:o/r.git" }) }))
        .status,
    ).toBe("no-gh")
    const signedOut = await GithubWork.read({
      directory: "/p",
      gh: "gh",
      run: runner({
        git: "git@github.com:o/r.git",
        gh: new Error("To get started with GitHub CLI, please run:  gh auth login"),
      }),
    })
    expect(signedOut.status).toBe("signed-out")
  })

  test("a bad override runs nothing", async () => {
    const calls: Call[] = []
    const work = await GithubWork.read({ directory: "/p", gh: "gh", repo: "o/r --web", run: runner({}, calls) })
    expect(work.status).toBe("no-repo")
    expect(calls).toHaveLength(0)
  })
})

describe("AC-19 the repository a Project names", () => {
  test("overlapping saves for two folders keep both", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = await mkdtemp(join(tmpdir(), "tenon-github-"))
    try {
      await Promise.all([
        GithubWork.setStoredRepo(join(dir, "a"), "owner/a", dir),
        GithubWork.setStoredRepo(join(dir, "b"), "owner/b", dir),
      ])
      expect(await GithubWork.storedRepo(join(dir, "a"), dir)).toBe("owner/a")
      expect(await GithubWork.storedRepo(join(dir, "b"), dir)).toBe("owner/b")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
