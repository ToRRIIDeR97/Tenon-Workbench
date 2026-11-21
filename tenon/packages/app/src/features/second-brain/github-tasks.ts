// A Project's GitHub issues as tasks (#331, variant A): every open issue of the linked repository is a task, the PR
// that closes it hangs under it, and under "All" the issues closed in the last two weeks show as done.

export type GithubIssue = {
  number: number
  title: string
  url: string
  state: "open" | "closed"
  updatedAt: string
  closedAt?: string
  author: string
  labels: ReadonlyArray<string>
}
export type GithubPull = {
  number: number
  title: string
  url: string
  state: "open" | "merged" | "closed"
  draft: boolean
  checks?: "passing" | "failing" | "pending"
  review?: "approved" | "changes" | "required"
  closes: ReadonlyArray<number>
  /** The Project thread that produced the PR (its messages first carry the URL). */
  thread?: { id: string; title: string }
}
export type GithubWorkOk = {
  status: "ok"
  repo: string
  issues: ReadonlyArray<GithubIssue>
  pulls: ReadonlyArray<GithubPull>
  source?: "origin" | "project"
}
export type GithubWork =
  | GithubWorkOk
  | { status: "no-repo" | "no-gh" | "signed-out" }
  | { status: "error"; message: string }

export type GithubTaskStatus = "merged" | "checks-failing" | "changes-requested" | "in-review" | "draft"
export type GithubTaskRow = {
  /** An issue (with the PRs that close it), or a PR that closes none of the listed issues. */
  kind: "issue" | "pull"
  number: number
  title: string
  url: string
  author: string
  done: boolean
  pulls: GithubPull[]
  status?: GithubTaskStatus
  /** The thread that produced the PR the row shows, so a merged PR leads back to its conversation. */
  thread?: { id: string; title: string }
}

const RECENT_MS = 14 * 24 * 60 * 60 * 1000

/** Issue numbers a Tenon task already mirrors: its title ends with `(#N)`, the way agents record a GitHub issue. */
export function linkedIssueNumbers(titles: ReadonlyArray<string>) {
  return new Set(titles.flatMap((title) => [...title.matchAll(/\(#(\d+)\)\s*$/g)].map((match) => Number(match[1]))))
}

/** `linked` issues are left out: their Tenon task already shows them. */
export function githubTaskRows(
  work: GithubWorkOk,
  show: "open" | "all",
  now = Date.now(),
  linked: ReadonlySet<number> = new Set(),
): GithubTaskRow[] {
  const shown = work.issues.filter((issue) =>
    linked.has(issue.number)
      ? false
      : issue.state === "open" || (show === "all" && !!issue.closedAt && now - Date.parse(issue.closedAt) <= RECENT_MS),
  )
  // Open first, newest change first; done issues after them.
  const issueRows: GithubTaskRow[] = shown
    .toSorted(
      (a, b) =>
        Number(a.state === "closed") - Number(b.state === "closed") ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )
    .map((issue) => {
      const pulls = work.pulls.filter((pull) => pull.closes.includes(issue.number))
      const shownPull = pulls.find((pull) => pull.state === "open") ?? pulls[0]
      return {
        kind: "issue" as const,
        number: issue.number,
        title: issue.title,
        url: issue.url,
        author: issue.author,
        done: issue.state === "closed",
        pulls,
        status: taskStatus(pulls),
        ...(shownPull?.thread ? { thread: shownPull.thread } : {}),
      }
    })
  // A PR that closes none of the listed issues has no issue to hang under, so it is a row of its own (#331): open
  // ones always, merged and closed ones under All.
  const listed = new Set(work.issues.map((issue) => issue.number))
  const pullRows: GithubTaskRow[] = work.pulls
    .filter((pull) => !pull.closes.some((number) => listed.has(number)))
    .filter((pull) => pull.state === "open" || show === "all")
    .toSorted((a, b) => Number(a.state !== "open") - Number(b.state !== "open") || b.number - a.number)
    .map((pull) => ({
      kind: "pull" as const,
      number: pull.number,
      title: pull.title,
      url: pull.url,
      author: "",
      done: pull.state !== "open",
      pulls: [pull],
      status: taskStatus([pull]),
      ...(pull.thread ? { thread: pull.thread } : {}),
    }))
  return [
    ...issueRows.filter((row) => !row.done),
    ...pullRows.filter((row) => !row.done),
    ...issueRows.filter((row) => row.done),
    ...pullRows.filter((row) => row.done),
  ]
}

/** The one state that matters most for the task, from the PRs that close it. */
function taskStatus(pulls: ReadonlyArray<GithubPull>): GithubTaskStatus | undefined {
  if (pulls.some((pull) => pull.state === "merged")) return "merged"
  const open = pulls.filter((pull) => pull.state === "open")
  if (open.length === 0) return undefined
  // A draft is still being written: its checks and reviews aren't the news yet.
  if (open.every((pull) => pull.draft)) return "draft"
  const ready = open.filter((pull) => !pull.draft)
  if (ready.some((pull) => pull.checks === "failing")) return "checks-failing"
  if (ready.some((pull) => pull.review === "changes")) return "changes-requested"
  return "in-review"
}
