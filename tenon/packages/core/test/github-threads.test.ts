import { describe, expect, test } from "bun:test"
import { GithubThreads } from "@tenon/core/github/threads"

const repo = "ToRRIIDeR97/Tenon-Workbench"
const mention = (sessionID: string, title: string, time: number, text: string) => ({ sessionID, title, time, text })

describe("GithubThreads.pullThreads", () => {
  test("AC-10 a PR maps to the earliest thread that mentions it", () => {
    const map = GithubThreads.pullThreads(
      [
        mention("ses_b", "Review it", 300, "Looks good: https://github.com/ToRRIIDeR97/Tenon-Workbench/pull/12"),
        mention("ses_a", "Fix login", 100, '{"stdout":"https://github.com/ToRRIIDeR97/Tenon-Workbench/pull/12\\n"}'),
      ],
      repo,
    )
    expect(map.get(12)).toEqual({ id: "ses_a", title: "Fix login" })
  })

  test("AC-10 sub-pages count, owner and name ignore case", () => {
    const map = GithubThreads.pullThreads(
      [
        mention("ses_a", "A", 1, "see https://github.com/torriider97/tenon-workbench/pull/7/files"),
        mention("ses_b", "B", 2, "and https://github.com/ToRRIIDeR97/Tenon-Workbench/pull/8#issuecomment-1"),
      ],
      repo,
    )
    expect(map.get(7)).toEqual({ id: "ses_a", title: "A" })
    expect(map.get(8)).toEqual({ id: "ses_b", title: "B" })
  })

  test("AC-10 other repositories, issues and look-alike hosts don't count", () => {
    const map = GithubThreads.pullThreads(
      [
        mention("ses_a", "A", 1, "https://github.com/ToRRIIDeR97/Tenon-Workbench-old/pull/3"),
        mention("ses_a", "A", 1, "https://github.com/someone/Tenon-Workbench/pull/4"),
        mention("ses_a", "A", 1, "https://github.com/ToRRIIDeR97/Tenon-Workbench/issues/5"),
        mention("ses_a", "A", 1, "https://evilgithub.com/ToRRIIDeR97/Tenon-Workbench/pull/6"),
        mention("ses_a", "A", 1, "https://github.com.evil.io/ToRRIIDeR97/Tenon-Workbench/pull/9"),
      ],
      repo,
    )
    expect([...map.keys()]).toEqual([])
  })
})

describe("GithubThreads.attach", () => {
  test("AC-11 PRs carry their thread, others are left as they were", () => {
    const pulls = [
      { number: 12, title: "Fix", url: "u", state: "merged" as const, draft: false, closes: [3] },
      { number: 13, title: "Other", url: "v", state: "open" as const, draft: false, closes: [] },
    ]
    const result = GithubThreads.attach(pulls, new Map([[12, { id: "ses_a", title: "Fix login" }]]))
    expect(result[0]).toEqual({ ...pulls[0], thread: { id: "ses_a", title: "Fix login" } })
    expect(result[1]).toEqual(pulls[1])
  })
})
