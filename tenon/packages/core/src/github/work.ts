export * as GithubWork from "./work"

import { execFile } from "child_process"
import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Effect } from "effect"
import { Location } from "../location"
import { which } from "../util/which"

// A Project's GitHub work (#331): the linked repository's issues and pull requests, read with the user's own `gh`
// login. Tenon stores no GitHub token: `gh` keeps its own (keychain on macOS, Credential Manager on Windows). Every
// call is `execFile` with fixed arguments and a validated `owner/repo`, never a shell.

export type Issue = {
  number: number
  title: string
  url: string
  state: "open" | "closed"
  updatedAt: string
  closedAt?: string
  author: string
  labels: string[]
}
export type Pull = {
  number: number
  title: string
  url: string
  state: "open" | "merged" | "closed"
  draft: boolean
  checks?: "passing" | "failing" | "pending"
  review?: "approved" | "changes" | "required"
  /** The issues this PR closes when it merges. */
  closes: number[]
}
export type Work =
  | { status: "ok"; repo: string; issues: Issue[]; pulls: Pull[]; source?: "origin" | "project" }
  | { status: "no-repo" }
  | { status: "no-gh" }
  | { status: "signed-out" }
  | { status: "error"; message: string }

type Run = (command: string, args: string[], cwd: string) => Promise<string>

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/
const ISSUE_FIELDS = "number,title,url,state,updatedAt,closedAt,labels,author"
const PULL_FIELDS = "number,title,url,state,isDraft,mergedAt,reviewDecision,closingIssuesReferences,statusCheckRollup"

export const validRepo = (repo: string) => REPO.test(repo) && !repo.endsWith(".git")

/** `owner/repo` from a GitHub remote in https, ssh or scp form; undefined for any other host. */
export function repoFromRemote(remote: string) {
  const match =
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(
      remote.trim(),
    )
  return match && validRepo(match[1]!) ? match[1] : undefined
}

/**
 * Open and recently closed issues plus recent PRs of the folder's repository: `repo` when given (it must be a plain
 * `owner/repo`), else the folder's `origin`. `gh` is the CLI's path, undefined when it isn't installed.
 */
export async function read(input: {
  directory: string
  repo?: string
  gh: string | undefined
  run?: Run
}): Promise<Work> {
  const run = input.run ?? execute
  const repo =
    input.repo !== undefined
      ? validRepo(input.repo)
        ? input.repo
        : undefined
      : await run("git", ["remote", "get-url", "origin"], input.directory).then(repoFromRemote, () => undefined)
  if (!repo) return { status: "no-repo" }
  if (!input.gh) return { status: "no-gh" }
  try {
    const [issues, pulls] = await Promise.all([
      run(
        input.gh,
        ["issue", "list", "--repo", repo, "--state", "all", "--limit", "100", "--json", ISSUE_FIELDS],
        input.directory,
      ),
      run(
        input.gh,
        ["pr", "list", "--repo", repo, "--state", "all", "--limit", "50", "--json", PULL_FIELDS],
        input.directory,
      ),
    ])
    return { status: "ok", repo, issues: parseIssues(issues), pulls: parsePulls(pulls) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/gh auth login|not logged in|authentication/i.test(message)) return { status: "signed-out" }
    return { status: "error", message: message.split("\n")[0]!.slice(0, 300) }
  }
}

/** The `gh` CLI on PATH (and Windows install folders through `which`), or undefined. */
export const findGh = () => which("gh") ?? undefined

// A Project page is opened often; one good answer per folder serves it for a minute. Failures aren't kept, so
// signing in with `gh auth login` shows at once; Refresh always asks again.
const cache = new Map<string, { at: number; work: Promise<Work> }>()
export function cached(input: { directory: string; repo?: string; refresh?: boolean }, now = Date.now()) {
  const key = `${input.directory}\0${input.repo ?? ""}`
  const hit = cache.get(key)
  if (hit && !input.refresh && now - hit.at < 60_000) return hit.work
  const work = read({ directory: input.directory, ...(input.repo ? { repo: input.repo } : {}), gh: findGh() })
  cache.set(key, { at: now, work })
  void work.then((value) => value.status !== "ok" && cache.get(key)?.work === work && cache.delete(key))
  return work
}

// The repository a Project names instead of its folder's origin, kept with Tenon's config per folder (not in one
// browser's storage), in `github-repos.json`.
const REPOS = "github-repos.json"
async function repos(configDir: string): Promise<Record<string, string>> {
  const text = await fs.readFile(path.join(configDir, REPOS), "utf8").catch(() => "")
  const value: unknown = text ? JSON.parse(text) : {}
  return typeof value === "object" && value !== null ? (value as Record<string, string>) : {}
}
export async function storedRepo(folder: string, configDir: string) {
  const value = (await repos(configDir))[path.resolve(folder)]
  return value && validRepo(value) ? value : undefined
}
// Saves run one after another, so two overlapping saves can't each read the old file and drop the other's entry.
let saving: Promise<unknown> = Promise.resolve()
export function setStoredRepo(folder: string, repo: string, configDir: string) {
  const next = saving.then(() => writeStoredRepo(folder, repo, configDir))
  saving = next.catch(() => undefined)
  return next
}
async function writeStoredRepo(folder: string, repo: string, configDir: string) {
  const current = await repos(configDir)
  const key = path.resolve(folder)
  const next = { ...current }
  if (repo && validRepo(repo)) next[key] = repo
  else delete next[key]
  await fs.mkdir(configDir, { recursive: true })
  // Through a temporary file, so a crash or a second save never leaves half a file.
  const file = path.join(configDir, REPOS)
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 })
  await fs.rename(temporary, file)
}

/** The Project folder's GitHub work, for the request's location (the server route). */
export const forLocation = Effect.fn("GithubWork.forLocation")(function* (input: {
  repo?: string
  save?: boolean
  refresh?: boolean
}) {
  const location = yield* Location.Service
  const config = Global.make().config
  return yield* Effect.promise(async () => {
    // A typed repository must be a plain owner/name; anything else is refused, and the saved choice stays.
    if (input.save && input.repo && !validRepo(input.repo))
      return { status: "error" as const, message: `"${input.repo.slice(0, 80)}" isn't owner/name.` }
    if (input.save) await setStoredRepo(location.directory, input.repo ?? "", config)
    const repo = input.save ? input.repo || undefined : (input.repo ?? (await storedRepo(location.directory, config)))
    const work = await cached({
      directory: location.directory,
      ...(repo ? { repo } : {}),
      refresh: input.refresh || input.save,
    })
    return work.status === "ok" ? { ...work, source: repo ? ("project" as const) : ("origin" as const) } : work
  })
})

function execute(command: string, args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) =>
    execFile(
      command,
      args,
      // gh reads its own login; GH_PROMPT_DISABLED keeps it from waiting on a terminal prompt.
      {
        cwd,
        timeout: 15_000,
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      },
      (error, stdout, stderr) => (error ? reject(new Error(`${stderr || error.message}`.trim())) : resolve(stdout)),
    ),
  )
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
const text = (value: unknown) => (typeof value === "string" ? value : "")
const list = (json: string) => {
  const value: unknown = JSON.parse(json)
  return Array.isArray(value) ? value.map(record) : []
}

function parseIssues(json: string): Issue[] {
  return list(json).flatMap((item) => {
    if (typeof item.number !== "number") return []
    const closedAt = text(item.closedAt)
    return [
      {
        number: item.number,
        title: text(item.title),
        url: text(item.url),
        state: text(item.state).toUpperCase() === "OPEN" ? "open" : "closed",
        updatedAt: text(item.updatedAt),
        ...(closedAt ? { closedAt } : {}),
        author: text(record(item.author).login),
        labels: (Array.isArray(item.labels) ? item.labels : [])
          .map((label) => text(record(label).name))
          .filter(Boolean),
      },
    ]
  })
}

function parsePulls(json: string): Pull[] {
  return list(json).flatMap((item) => {
    if (typeof item.number !== "number") return []
    const state = text(item.state).toUpperCase()
    const checks = (Array.isArray(item.statusCheckRollup) ? item.statusCheckRollup : []).map((check) => {
      const entry = record(check)
      return text(entry.conclusion || entry.state).toUpperCase()
    })
    const review = text(item.reviewDecision).toUpperCase()
    return [
      {
        number: item.number,
        title: text(item.title),
        url: text(item.url),
        state: state === "MERGED" ? "merged" : state === "OPEN" ? "open" : "closed",
        draft: item.isDraft === true,
        ...(checks.length === 0
          ? {}
          : {
              checks: checks.some((check) =>
                ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(check),
              )
                ? ("failing" as const)
                : checks.every((check) => ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(check))
                  ? ("passing" as const)
                  : ("pending" as const),
            }),
        ...(review === "APPROVED"
          ? { review: "approved" as const }
          : review === "CHANGES_REQUESTED"
            ? { review: "changes" as const }
            : review === "REVIEW_REQUIRED"
              ? { review: "required" as const }
              : {}),
        closes: (Array.isArray(item.closingIssuesReferences) ? item.closingIssuesReferences : [])
          .map((reference) => record(reference).number)
          .filter((number): number is number => typeof number === "number"),
      },
    ]
  })
}
