import { LayerNode } from "@tenon/core/effect/layer-node"
import { Effect, Layer, Context, Schema, Scope, Stream } from "effect"
import { execFile } from "node:child_process"
import { GithubWork } from "@tenon/core/github/work"
import { formatPatch, structuredPatch } from "diff"
import { InstanceState } from "@/effect/instance-state"
import { Watcher } from "@tenon/core/filesystem/watcher"
import { Git } from "@/git"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@tenon/core/event"
import { VcsEvent } from "@tenon/schema/vcs-event"
import { VcsPublish } from "./vcs-publish"

const PATCH_CONTEXT_LINES = 2_147_483_647
const MAX_PATCH_BYTES = 10_000_000
const MAX_TOTAL_PATCH_BYTES = 10_000_000
const UNTRACKED_STAT_CONCURRENCY = 8
type DiffOptions = {
  readonly context?: number
}

const emptyPatch = (file: string) => formatPatch(structuredPatch(file, file, "", "", "", "", { context: 0 }))

const nums = (list: Git.Stat[]) =>
  new Map(list.map((item) => [item.file, { additions: item.additions, deletions: item.deletions }] as const))

const merge = (...lists: Git.Item[][]) => {
  const out = new Map<string, Git.Item>()
  lists.flat().forEach((item) => {
    if (!out.has(item.file)) out.set(item.file, item)
  })
  return [...out.values()]
}

const emptyBatch = () => ({ patches: new Map<string, string>(), capped: false })

const parseQuotedPath = (value: string) => {
  let out = ""
  for (let idx = 1; idx < value.length; idx++) {
    const char = value[idx]
    if (char === '"') return { value: out, end: idx + 1 }
    if (char !== "\\") {
      out += char
      continue
    }

    const next = value[++idx]
    if (next === "t") out += "\t"
    else if (next === "n") out += "\n"
    else if (next === "r") out += "\r"
    else if (next === '"' || next === "\\") out += next
    else out += next ?? ""
  }
}

const parsePathToken = (value: string) => {
  if (!value.startsWith('"')) return value.split("\t")[0]
  return parseQuotedPath(value)?.value ?? value
}

const fileFromDiffPath = (value: string | undefined) => {
  if (!value || value === "/dev/null") return
  const file = parsePathToken(value)
  if (file.startsWith("a/") || file.startsWith("b/")) return file.slice(2)
  return file
}

const fileFromGitHeader = (header: string) => {
  if (header.startsWith('"')) {
    const first = parseQuotedPath(header)
    const second = first ? header.slice(first.end).trimStart() : undefined
    if (!second) return
    if (!second.startsWith('"')) return fileFromDiffPath(second)
    return fileFromDiffPath(parseQuotedPath(second)?.value)
  }

  const separator = header.indexOf(" b/")
  if (separator === -1) return
  return fileFromDiffPath(header.slice(separator + 1))
}

const fileFromPatchChunk = (chunk: string) => {
  const next = /^\+\+\+ (.+)$/m.exec(chunk)?.[1]
  const before = /^--- (.+)$/m.exec(chunk)?.[1]
  const file = fileFromDiffPath(next) ?? fileFromDiffPath(before)
  if (file) return file

  const header = /^diff --git (.+)$/m.exec(chunk)?.[1]
  return fileFromGitHeader(header ?? "")
}

const splitGitPatch = (patch: Git.Patch) => {
  const starts = [...patch.text.matchAll(/(?:^|\n)diff --git /g)].map((match) =>
    match[0].startsWith("\n") ? match.index + 1 : match.index,
  )
  const chunks = starts.map((start, index) => patch.text.slice(start, starts[index + 1] ?? patch.text.length))
  if (!patch.truncated) return chunks
  return chunks.slice(0, -1)
}

const batchPatches = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string,
  list: Git.Item[],
  options?: DiffOptions,
) {
  if (list.length === 0) return { patches: new Map<string, string>(), capped: false }

  const result = yield* git.patchAll(cwd, ref, {
    context: options?.context ?? PATCH_CONTEXT_LINES,
    maxOutputBytes: MAX_TOTAL_PATCH_BYTES,
  })

  return {
    patches: splitGitPatch(result).reduce((acc, patch, index) => {
      const file = fileFromPatchChunk(patch) ?? list[index]?.file
      if (!file) return acc
      acc.set(file, (acc.get(file) ?? "") + patch)
      return acc
    }, new Map<string, string>()),
    capped: result.truncated,
  }
})

const nativePatch = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  item: Git.Item,
  options?: DiffOptions,
) {
  const result =
    item.code === "??" || !ref
      ? yield* git.patchUntracked(cwd, item.file, {
          context: options?.context ?? PATCH_CONTEXT_LINES,
          maxOutputBytes: MAX_PATCH_BYTES,
        })
      : yield* git.patch(cwd, ref, item.file, {
          context: options?.context ?? PATCH_CONTEXT_LINES,
          maxOutputBytes: MAX_PATCH_BYTES,
        })
  if (!result.truncated && result.text) return result.text

  return emptyPatch(item.file)
})

const totalPatch = (file: string, patch: string, total: number) => {
  if (total + Buffer.byteLength(patch) <= MAX_TOTAL_PATCH_BYTES) return { patch, capped: false }
  return { patch: emptyPatch(file), capped: true }
}

const patchForItem = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  item: Git.Item,
  batch: { patches: Map<string, string>; capped: boolean },
  capped: boolean,
  options?: DiffOptions,
) {
  if (capped) return emptyPatch(item.file)

  const batched = batch.patches.get(item.file)
  if (batched !== undefined) return batched
  if (item.code !== "??" && batch.capped) return emptyPatch(item.file)
  return yield* nativePatch(git, cwd, ref, item, options)
})

const files = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  list: Git.Item[],
  map: Map<string, { additions: number; deletions: number }>,
  batch: { patches: Map<string, string>; capped: boolean },
  options?: DiffOptions,
) {
  const next: FileDiff[] = []
  let total = 0
  let capped = false

  const sorted = list.toSorted((a, b) => a.file.localeCompare(b.file))
  const stats = yield* Effect.forEach(
    sorted,
    (item) =>
      map.has(item.file) || item.status !== "added"
        ? Effect.succeed(map.get(item.file))
        : git.statUntracked(cwd, item.file),
    { concurrency: UNTRACKED_STAT_CONCURRENCY },
  )
  for (const [index, item] of sorted.entries()) {
    const stat = stats[index]
    const patch = yield* patchForItem(git, cwd, ref, item, batch, capped, options)
    const result: { patch: string; capped: boolean } = capped
      ? { patch, capped: true }
      : totalPatch(item.file, patch, total)
    capped = capped || result.capped
    if (!capped) {
      total += Buffer.byteLength(result.patch)
      capped = total >= MAX_TOTAL_PATCH_BYTES
    }
    next.push({
      file: item.file,
      patch: result.patch,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      status: item.status,
    })
  }

  return next
})

const diffAgainstRef = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string,
  options?: DiffOptions,
) {
  const [list, stats, extra] = yield* Effect.all([git.diff(cwd, ref), git.stats(cwd, ref), git.status(cwd)], {
    concurrency: 3,
  })
  return yield* files(
    git,
    cwd,
    ref,
    merge(
      list,
      extra.filter((item) => item.code === "??"),
    ),
    nums(stats),
    yield* batchPatches(git, cwd, ref, list, options),
    options,
  )
})

const track = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  options?: DiffOptions,
) {
  if (!ref) return yield* files(git, cwd, ref, yield* git.status(cwd), new Map(), emptyBatch(), options)
  return yield* diffAgainstRef(git, cwd, ref, options)
})

export const Mode = Schema.Literals(["git", "branch"])
export type Mode = Schema.Schema.Type<typeof Mode>

export const Event = VcsEvent

export const Info = Schema.Struct({
  branch: Schema.optional(Schema.String),
  default_branch: Schema.optional(Schema.String),
}).annotate({ identifier: "VcsInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export const FileDiff = Schema.Struct({
  file: Schema.String,
  patch: Schema.optional(Schema.String),
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
}).annotate({ identifier: "VcsFileDiff" })
export type FileDiff = Schema.Schema.Type<typeof FileDiff>

export const FileStatus = Schema.Struct({
  file: Schema.String,
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "VcsFileStatus" })
export type FileStatus = Schema.Schema.Type<typeof FileStatus>

export const ApplyInput = Schema.Struct({
  patch: Schema.String,
})
export type ApplyInput = Schema.Schema.Type<typeof ApplyInput>

export const ApplyResult = Schema.Struct({
  applied: Schema.Boolean,
})
export type ApplyResult = Schema.Schema.Type<typeof ApplyResult>

export const SwitchBranchInput = Schema.Struct({
  branch: Schema.String,
})
export type SwitchBranchInput = Schema.Schema.Type<typeof SwitchBranchInput>

export class BranchSwitchError extends Schema.TaggedError<BranchSwitchError>()("VcsBranchSwitchError", {
  message: Schema.String,
  reason: Schema.Literals(["non-git", "unknown-branch", "failed"]),
}) {}

export const CommitInput = Schema.Struct({ message: Schema.String, branch: Schema.optional(Schema.String) })
export type CommitInput = Schema.Schema.Type<typeof CommitInput>
export const CommitResult = Schema.Struct({ sha: Schema.String, branch: Schema.String })
export type CommitResult = Schema.Schema.Type<typeof CommitResult>
export const PushResult = Schema.Struct({ branch: Schema.String })
export const PullRequestInput = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  base: Schema.optional(Schema.String),
  draft: Schema.Boolean,
})
export type PullRequestInput = Schema.Schema.Type<typeof PullRequestInput>
export const PullRequestResult = Schema.Struct({ url: Schema.String })

export const PublishReason = Schema.Literals([
  "non-git",
  "invalid",
  "invalid-branch",
  "nothing",
  "no-remote",
  "detached",
  "gh-missing",
  "failed",
])

export class PublishError extends Schema.TaggedError<PublishError>()("VcsPublishError", {
  message: Schema.String,
  reason: PublishReason,
}) {}

export class PatchApplyError extends Schema.TaggedError<PatchApplyError>()("VcsPatchApplyError", {
  message: Schema.String,
  reason: Schema.Literals(["non-git", "not-clean"]),
}) {}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly branch: () => Effect.Effect<string | undefined>
  readonly defaultBranch: () => Effect.Effect<string | undefined>
  readonly status: () => Effect.Effect<FileStatus[]>
  readonly diff: (mode: Mode, options?: DiffOptions) => Effect.Effect<FileDiff[]>
  readonly diffRaw: () => Effect.Effect<string>
  readonly apply: (input: ApplyInput) => Effect.Effect<ApplyResult, PatchApplyError>
  readonly branches: () => Effect.Effect<string[]>
  readonly switchBranch: (input: SwitchBranchInput) => Effect.Effect<Info, BranchSwitchError>
  readonly commit: (input: CommitInput) => Effect.Effect<CommitResult, PublishError>
  readonly push: () => Effect.Effect<{ branch: string }, PublishError>
  readonly pullRequest: (input: PullRequestInput) => Effect.Effect<{ url: string }, PublishError>
}

interface State {
  current: string | undefined
  root: Git.Base | undefined
}

export class Service extends Context.Service<Service, Interface>()("@tenon/Vcs") {}

const layer: Layer.Layer<Service, never, Git.Service | EventV2Bridge.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const git = yield* Git.Service
    const events = yield* EventV2Bridge.Service
    const scope = yield* Scope.Scope

    const state = yield* InstanceState.make<State>(
      Effect.fn("Vcs.state")(function* (ctx) {
        if (ctx.project.vcs !== "git") {
          return { current: undefined, root: undefined }
        }

        const get = Effect.fnUntraced(function* () {
          return yield* git.branch(ctx.directory)
        })
        const [current, root] = yield* Effect.all([git.branch(ctx.directory), git.defaultBranch(ctx.directory)], {
          concurrency: 2,
        })
        const value = { current, root }

        const unsubscribe = yield* events.listen((event) => {
          if (event.type !== Watcher.Event.Updated.type || event.location?.directory !== ctx.directory)
            return Effect.void
          const data = event.data as EventV2.Data<typeof Watcher.Event.Updated>
          if (!data.file.endsWith("HEAD")) return Effect.void
          return Effect.gen(function* () {
            const next = yield* get()
            if (next !== value.current) {
              value.current = next
              yield* events.publish(Event.BranchUpdated, { branch: next })
            }
          })
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        return value
      }),
    )

    return Service.of({
      init: Effect.fn("Vcs.init")(function* () {
        yield* InstanceState.get(state).pipe(Effect.forkIn(scope))
      }),
      branch: Effect.fn("Vcs.branch")(function* () {
        return yield* InstanceState.use(state, (x) => x.current)
      }),
      defaultBranch: Effect.fn("Vcs.defaultBranch")(function* () {
        return yield* InstanceState.use(state, (x) => x.root?.name)
      }),
      status: Effect.fn("Vcs.status")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        const ref = (yield* git.hasHead(ctx.directory)) ? "HEAD" : undefined
        const [list, stats] = yield* Effect.all(
          [git.status(ctx.directory), ref ? git.stats(ctx.directory, ref) : Effect.succeed([])],
          { concurrency: 2 },
        )
        const map = nums(stats)
        return yield* Effect.forEach(
          list.toSorted((a, b) => a.file.localeCompare(b.file)),
          (item) =>
            Effect.gen(function* () {
              const stat =
                map.get(item.file) ??
                (item.status === "added" ? yield* git.statUntracked(ctx.worktree, item.file) : undefined)
              return {
                file: item.file,
                additions: stat?.additions ?? 0,
                deletions: stat?.deletions ?? 0,
                status: item.status,
              } satisfies FileStatus
            }),
          { concurrency: UNTRACKED_STAT_CONCURRENCY },
        )
      }),
      diff: Effect.fn("Vcs.diff")(function* (mode: Mode, options?: DiffOptions) {
        const value = yield* InstanceState.get(state)
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        if (mode === "git") {
          return yield* track(git, ctx.directory, (yield* git.hasHead(ctx.directory)) ? "HEAD" : undefined, options)
        }

        if (!value.root) return []
        if (value.current && value.current === value.root.name) return []
        const ref = yield* git.mergeBase(ctx.directory, value.root.ref)
        if (!ref) return []
        return yield* diffAgainstRef(git, ctx.directory, ref, options)
      }),
      diffRaw: Effect.fn("Vcs.diffRaw")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return ""
        const [hasHead, status] = yield* Effect.all([git.hasHead(ctx.directory), git.status(ctx.directory)], {
          concurrency: 2,
        })
        const tracked = hasHead ? (yield* git.patchAll(ctx.directory, "HEAD")).text : ""
        const untracked = yield* Effect.forEach(
          status.filter((item) => item.code === "??"),
          (item) => git.patchUntracked(ctx.directory, item.file).pipe(Effect.map((patch) => patch.text)),
        )
        return [tracked, ...untracked].filter(Boolean).join("\n")
      }),
      apply: Effect.fn("Vcs.apply")(function* (input: ApplyInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") {
          return yield* new PatchApplyError({
            message: "Patch can't be applied because the project is not git-based",
            reason: "non-git",
          })
        }
        const applied = yield* git.applyPatch(ctx.directory, input.patch)
        if (applied.exitCode !== 0) {
          return yield* new PatchApplyError({
            message: "Patch can't be applied",
            reason: "not-clean",
          })
        }
        return { applied: true }
      }),
      branches: Effect.fn("Vcs.branches")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        return yield* localBranches(git, ctx.directory)
      }),
      switchBranch: Effect.fn("Vcs.switchBranch")(function* (input: SwitchBranchInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") {
          return yield* new BranchSwitchError({ message: "This folder isn't a git repository", reason: "non-git" })
        }
        if (!(yield* localBranches(git, ctx.directory)).includes(input.branch)) {
          return yield* new BranchSwitchError({
            message: `No local branch named ${input.branch}`,
            reason: "unknown-branch",
          })
        }
        const result = yield* git.run(["switch", input.branch], { cwd: ctx.directory })
        if (result.exitCode !== 0) {
          const detail = result.stderr.toString("utf8").trim().split(/\r?\n/)[0]
          return yield* new BranchSwitchError({
            message: detail || `Couldn't switch to ${input.branch}`,
            reason: "failed",
          })
        }
        const value = yield* InstanceState.get(state)
        value.current = input.branch
        yield* events.publish(Event.BranchUpdated, { branch: input.branch })
        return { branch: input.branch, default_branch: value.root?.name }
      }),
      commit: Effect.fn("Vcs.commit")(function* (input: CommitInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return yield* publishError("non-git", "This folder isn't a git repository")
        if (VcsPublish.messageProblem(input.message))
          return yield* publishError("invalid", "Write a commit message first")
        const branch = input.branch?.trim()
        if (branch !== undefined && branch !== "" && !VcsPublish.validBranchName(branch))
          return yield* publishError("invalid-branch", `${branch} isn't a valid branch name`)
        const status = yield* git.run(["status", "--porcelain"], { cwd: ctx.directory })
        if (status.exitCode !== 0) return yield* publishError("failed", firstLine(status) || "Couldn't read changes")
        if (!status.text().trim()) return yield* publishError("nothing", "There are no changes to commit")
        if (branch) {
          const created = yield* git.run(["switch", "-c", branch], { cwd: ctx.directory })
          if (created.exitCode !== 0)
            return yield* publishError("failed", firstLine(created) || `Couldn't create ${branch}`)
        }
        const added = yield* git.run(["add", "-A"], { cwd: ctx.directory })
        if (added.exitCode !== 0) return yield* publishError("failed", firstLine(added) || "Couldn't stage changes")
        const committed = yield* git.run(["commit", "-F", "-"], { cwd: ctx.directory, stdin: stdinText(input.message) })
        if (committed.exitCode !== 0)
          return yield* publishError("failed", firstLine(committed) || "Couldn't commit the changes")
        const sha = (yield* git.run(["rev-parse", "HEAD"], { cwd: ctx.directory })).text().trim()
        const current = (yield* git.branch(ctx.directory)) ?? branch ?? ""
        const value = yield* InstanceState.get(state)
        if (current && value.current !== current) {
          value.current = current
          yield* events.publish(Event.BranchUpdated, { branch: current })
        }
        return { sha, branch: current }
      }),
      push: Effect.fn("Vcs.push")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return yield* publishError("non-git", "This folder isn't a git repository")
        const branch = yield* git.branch(ctx.directory)
        if (!branch) return yield* publishError("detached", "Switch to a branch before pushing")
        const remote = yield* git.run(["remote", "get-url", "origin"], { cwd: ctx.directory })
        if (remote.exitCode !== 0) return yield* publishError("no-remote", "This repository has no origin remote")
        const pushed = yield* git.run(["push", "-u", "origin", branch], {
          cwd: ctx.directory,
          env: { GIT_TERMINAL_PROMPT: "0" },
        })
        if (pushed.exitCode !== 0) return yield* publishError("failed", firstLine(pushed) || `Couldn't push ${branch}`)
        return { branch }
      }),
      pullRequest: Effect.fn("Vcs.pullRequest")(function* (input: PullRequestInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return yield* publishError("non-git", "This folder isn't a git repository")
        if (!input.title.trim()) return yield* publishError("invalid", "Give the pull request a title")
        const gh = GithubWork.findGh()
        if (!gh)
          return yield* publishError("gh-missing", "Install the GitHub CLI (gh) and sign in to open pull requests")
        const args = yield* Effect.try({
          try: () => VcsPublish.prCreateArgs({ ...input, title: input.title.trim() }),
          catch: () => new PublishError({ message: "That base branch isn't valid", reason: "invalid-branch" }),
        })
        const output = yield* Effect.tryPromise({
          try: () => runGh(gh, args, ctx.directory),
          catch: (error) =>
            new PublishError({
              message: (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 300),
              reason: "failed",
            }),
        })
        const url = VcsPublish.prUrl(output)
        if (!url) return yield* publishError("failed", "gh didn't return a pull request link")
        return { url }
      }),
    })
  }),
)

const publishError = (reason: Schema.Schema.Type<typeof PublishReason>, message: string) =>
  Effect.fail(new PublishError({ message, reason }))

const firstLine = (result: Git.Result) =>
  (result.stderr.toString("utf8").trim() || result.text().trim()).split(/\r?\n/)[0]?.slice(0, 300) ?? ""

const stdinText = (text: string) => Stream.make(new TextEncoder().encode(text))

const runGh = (gh: string, args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      gh,
      args,
      {
        cwd,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || error.message)))
        else resolve(`${stdout}\n${stderr}`)
      },
    )
  })

const localBranches = Effect.fnUntraced(function* (git: Git.Interface, cwd: string) {
  const result = yield* git.run(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd })
  if (result.exitCode !== 0) return []
  return result
    .text()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
})

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Git.node, EventV2Bridge.node] })

export * as Vcs from "./vcs"
