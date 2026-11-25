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
  closedAt?: string
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
  kind: "issue" | "pull"
  number: number
  title: string
  url: string
  author: string
  done: boolean
  pulls: GithubPull[]
  status?: GithubTaskStatus
  thread?: { id: string; title: string }
}

const RECENT_MS = 14 * 24 * 60 * 60 * 1000

export function linkedIssueNumbers(titles: ReadonlyArray<string>) {
  return new Set(titles.flatMap((title) => [...title.matchAll(/\(#(\d+)\)\s*$/g)].map((match) => Number(match[1]))))
}

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
  const listed = new Set(work.issues.map((issue) => issue.number))
  const pullRows: GithubTaskRow[] = work.pulls
    .filter((pull) => !pull.closes.some((number) => listed.has(number)))
    .filter(
      (pull) =>
        pull.state === "open" || (show === "all" && (!pull.closedAt || now - Date.parse(pull.closedAt) <= RECENT_MS)),
    )
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

function taskStatus(pulls: ReadonlyArray<GithubPull>): GithubTaskStatus | undefined {
  if (pulls.some((pull) => pull.state === "merged")) return "merged"
  const open = pulls.filter((pull) => pull.state === "open")
  if (open.length === 0) return undefined
  if (open.every((pull) => pull.draft)) return "draft"
  const ready = open.filter((pull) => !pull.draft)
  if (ready.some((pull) => pull.checks === "failing")) return "checks-failing"
  if (ready.some((pull) => pull.review === "changes")) return "changes-requested"
  return "in-review"
}
