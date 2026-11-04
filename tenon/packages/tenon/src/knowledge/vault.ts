export * as KnowledgeVault from "./vault"

import { KeyedMutex } from "@tenon/core/effect/keyed-mutex"
import { FileMutation } from "@tenon/core/file-mutation"
import { FSUtil } from "@tenon/core/fs-util"
import { Frontmatter } from "@tenon/core/frontmatter"
import { Global } from "@tenon/core/global"
import { Location } from "@tenon/core/location"
import { LocationMutation } from "@tenon/core/location-mutation"
import { ProjectV2 } from "@tenon/core/project"
import { Effect, Option, Schema } from "effect"
import matter from "gray-matter"
import { createHash, randomBytes } from "node:crypto"
import { lstat, rmdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ulid } from "ulid"
import { BrainProject } from "../project/brain"
import { titleFromBody } from "./note"

/**
 * The Tenon vault: one machine-wide folder of readable Markdown, outside every code folder.
 *
 *   <root>/<Workspace>/workspace.json            { version, id, name, repository? }  (no machine paths)
 *   <root>/<Workspace>/<page>.md                 workspace pages
 *   <root>/<Workspace>/<Project>/project.json    { version, id, name }
 *   <root>/<Workspace>/<Project>/<page>.md       Project pages
 *   <root>/<Workspace>/<Project>/timeline.json   { version, items }
 *   <root>/<Workspace>/<Project>/log/<machine>.md  one append-only file per machine
 *   <root>/<Workspace>/.history/<page>/<epoch>-<hash>.md  earlier versions of a page
 *   <root>/.backups/<timestamp>/<Workspace>/...  originals copied in by a migration
 *
 * Which vault folder belongs to which workspace directory, and this machine's id, live in the app data
 * folder (`vault-machine.json`), never in the vault, so a synced vault carries no absolute paths.
 */

const maxBytes = 5 * 1024 * 1024
const smallFileLimit = 64 * 1024
const pageLimit = 1_000
const historyLimit = 20
const logLimit = 1_000
const titleLimit = 200
const segmentLimit = 120
const pathLimit = 400
const projectPattern = /^project_[0-9A-Z]+$/i
const revisionPattern = /^\d{13}-[0-9a-f]{16}$/
const reservedKeys = new Set(["id", "title", "updated_at"])
const conflictPattern = /conflicted copy|\(conflict|\.sync-conflict-/i
/**
 * OneDrive keeps both copies of a clash by adding the machine name, `Plan-DESKTOP-ABC123.md` or
 * `Plan-LAPTOP-9F2K1.md` (Windows default names are upper case), sometimes with a counter (`-2`).
 */
const oneDriveConflict = /-(?:DESKTOP|LAPTOP)-[A-Z0-9]{4,}(?:-\d+)?(?=\.[^.]+$|$)/
const isConflictCopy = (name: string) => conflictPattern.test(name) || oneDriveConflict.test(name)
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true })
const locks = KeyedMutex.makeUnsafe<string>()

export const WorkspaceInfo = Schema.Struct({ id: Schema.String, name: Schema.String, folder: Schema.String })
export const Info = Schema.Struct({ root: Schema.String, workspace: WorkspaceInfo })
export type Info = typeof Info.Type

export const Properties = Schema.Record(Schema.String, Schema.Unknown)

export const PageInfo = Schema.Struct({
  id: Schema.String,
  /** Relative to the workspace's vault folder, with `/` separators. */
  path: Schema.String,
  title: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  properties: Properties,
  updatedAt: Schema.String,
})
export type PageInfo = typeof PageInfo.Type

export const Page = Schema.Struct({ info: PageInfo, body: Schema.String, revision: Schema.String })
export type Page = typeof Page.Type

export const PageWriteInput = Schema.Struct({
  body: Schema.String,
  title: Schema.optional(Schema.String),
  /** With a Project, `path` is relative to that Project's folder (a path already inside it is kept). */
  projectId: Schema.optional(Schema.String),
  /** Replaces the page's front matter properties when given. */
  properties: Schema.optional(Properties),
  expectedRevision: Schema.optional(Schema.String),
  create: Schema.optional(Schema.Boolean),
})
export type PageWriteInput = typeof PageWriteInput.Type

export const PageVersion = Schema.Struct({ revision: Schema.String, updatedAt: Schema.String })
export const PageVersionBody = Schema.Struct({ revision: Schema.String, body: Schema.String })

export const TimelineItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  kind: Schema.Literals(["task", "milestone"]),
  status: Schema.Literals(["todo", "doing", "done"]),
  start: Schema.optional(Schema.String),
  end: Schema.optional(Schema.String),
})
export type TimelineItem = typeof TimelineItem.Type

export const Timeline = Schema.Struct({
  projectId: Schema.String,
  revision: Schema.String,
  items: Schema.Array(TimelineItem),
  progress: Schema.Number,
})
export type Timeline = typeof Timeline.Type

export const TimelineWriteInput = Schema.Struct({
  items: Schema.Array(TimelineItem),
  expectedRevision: Schema.optional(Schema.String),
})
export type TimelineWriteInput = typeof TimelineWriteInput.Type

export const LogEntry = Schema.Struct({
  at: Schema.String,
  author: Schema.String,
  text: Schema.String,
  machine: Schema.String,
})
export type LogEntry = typeof LogEntry.Type

export const LogInput = Schema.Struct({ text: Schema.String, author: Schema.String })
export type LogInput = typeof LogInput.Type

export const Conflict = Schema.Struct({ path: Schema.String, original: Schema.String })
export type Conflict = typeof Conflict.Type

export const MigrateResult = Schema.Struct({
  moved: Schema.Number,
  /** Relative to the vault root; null when nothing was moved. */
  backup: Schema.NullOr(Schema.String),
})
export type MigrateResult = typeof MigrateResult.Type

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("KnowledgeVault.InvalidError", {
  reason: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("KnowledgeVault.NotFoundError", {
  path: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("KnowledgeVault.ConflictError", {
  reason: Schema.String,
}) {}

/** What the vault knows about the request's workspace. `directory` is only used for the machine-local map. */
export interface Workspace {
  readonly directory: string
  readonly name: string
  /** A machine-independent id of the workspace (the git root commit), used to find its folder on a new machine. */
  readonly repository?: string
}

/** An opened workspace folder of the vault. */
export interface Vault {
  readonly root: string
  readonly folder: string
  /** Canonical path of the workspace's vault folder; every read and write stays inside it. */
  readonly directory: string
  readonly id: string
  readonly name: string
  readonly machine: string
}

/** `TENON_VAULT_DIR` when set, else `<home>/Documents/Tenon`. `api` lets tests check both platforms. */
export function rootFor(env: Record<string, string | undefined>, home: string, api: path.PlatformPath = path) {
  const chosen = env.TENON_VAULT_DIR?.trim()
  return api.resolve(chosen || api.join(home, "Documents", "Tenon"))
}

/**
 * Whether `root` is, or sits inside, one of `folders` (a workspace or Project code folder). Windows paths
 * compare without letter case. `api` lets tests check both platforms.
 */
export function rootInside(root: string, folders: ReadonlyArray<string>, api: path.PlatformPath = path) {
  const fold = (value: string) => (api === path.win32 ? value.toLowerCase() : value)
  return folders.some((folder) => {
    const relative = api.relative(fold(api.resolve(folder)), fold(api.resolve(root)))
    return relative === "" || (!relative.startsWith("..") && !api.isAbsolute(relative))
  })
}

/**
 * Find or create the workspace's folder under the vault root. A root inside this workspace or one of
 * its linked Project folders is refused, so vault writes can never land in a code folder.
 */
export const open = Effect.fn("KnowledgeVault.open")(function* (workspace: Workspace) {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const root = rootFor(process.env, global.home)
  const code = [workspace.directory, ...(yield* BrainProject.linkedFolders())]
  const real = yield* fs.realPath(root).pipe(Effect.orElseSucceed(() => root))
  const codeReal = yield* Effect.forEach(code, (folder) => fs.realPath(folder).pipe(Effect.orElseSucceed(() => folder)))
  if (rootInside(root, code) || rootInside(real, codeReal))
    return yield* new InvalidError({ reason: "vault_inside_workspace" })
  return yield* locks.withLock(`root:${root}`)(
    Effect.gen(function* () {
      yield* fs.ensureDir(root)
      const machine = yield* readMachine()
      const mapped = machine.roots[root]?.[workspace.directory]
      const folders = yield* workspaceFolders(root)
      // A vault moved to a new root (Settings copies it) keeps its workspace ids, so the id this
      // directory had under an earlier root still finds its folder.
      const known =
        mapped ??
        Object.values(machine.roots)
          .map((directories) => directories[workspace.directory])
          .find((id) => id !== undefined && folders.some((item) => item.id === id))
      const found =
        folders.find((item) => known !== undefined && item.id === known) ??
        (workspace.repository ? folders.find((item) => item.repository === workspace.repository) : undefined)
      const entry = found ?? (yield* createWorkspaceFolder(root, workspace, known, folders))
      if (mapped !== entry.id)
        yield* writeMachine({
          ...machine,
          roots: { ...machine.roots, [root]: { ...machine.roots[root], [workspace.directory]: entry.id } },
        })
      const directory = yield* fs.realPath(path.join(root, entry.folder))
      return { root, folder: entry.folder, directory, id: entry.id, name: entry.name, machine: machine.machine }
    }),
  )
})

/**
 * The workspace folders this machine has opened a vault for, under any root. A workspace that is not a git
 * repository has no project record of its own, so this is how the server finds it again.
 */
export const knownWorkspaces = Effect.fn("KnowledgeVault.knownWorkspaces")(function* () {
  const { machine } = yield* loadMachine()
  if (machine === undefined) return []
  return [...new Set(Object.values(machine.roots).flatMap((directories) => Object.keys(directories)))]
})

/** The vault's view of an opened instance: its directory, a display name and, for a repository, its id. */
export function workspaceFor(context: { directory: string; project: { id: string; name?: string } }): Workspace {
  return {
    directory: context.directory,
    name: path.basename(context.directory) || context.project.name || "Workspace",
    ...(context.project.id !== ProjectV2.ID.global ? { repository: context.project.id } : {}),
  }
}

export function info(vault: Vault): Info {
  return { root: vault.root, workspace: { id: vault.id, name: vault.name, folder: vault.folder } }
}

export const listPages = Effect.fn("KnowledgeVault.listPages")(function* (
  vault: Vault,
  filter: { project?: string; search?: string } = {},
) {
  const fs = yield* FSUtil.Service
  const projects = yield* projectFolders(vault)
  const files = yield* fs.glob("**/*.md", { cwd: vault.directory, absolute: false, include: "file", dot: false })
  const query = filter.search?.trim().toLowerCase() ?? ""
  const pages = yield* Effect.forEach(
    files.map((file) => file.replaceAll("\\", "/")).filter((file) => isListedPage(file, projects)),
    (file) =>
      readPageFile(vault, file, projects).pipe(
        Effect.map((page) => {
          if (filter.project !== undefined && page.info.projectId !== filter.project) return undefined
          if (!query) return page.info
          const text = [page.info.title, page.info.path, page.body].join("\n").toLowerCase()
          return text.includes(query) ? page.info : undefined
        }),
        Effect.catch((error) =>
          Effect.logWarning("Skipping unreadable vault page", { path: file, error: error._tag }).pipe(
            Effect.as(undefined),
          ),
        ),
      ),
    { concurrency: 8 },
  )
  return pages
    .filter((page): page is PageInfo => page !== undefined)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.path.localeCompare(right.path))
    .slice(0, pageLimit)
})

export const readPage = Effect.fn("KnowledgeVault.readPage")(function* (vault: Vault, input: string) {
  const page = yield* readPageFile(vault, yield* pagePath(input), yield* projectFolders(vault))
  return { info: page.info, body: page.body, revision: page.revision }
})

export const writePage = Effect.fn("KnowledgeVault.writePage")(function* (
  vault: Vault,
  input: string,
  write: PageWriteInput,
) {
  const files = yield* FileMutation.Service
  const relative = yield* pagePath(input)
  const project = write.projectId === undefined ? undefined : yield* ensureProjectFolder(vault, write.projectId)
  const full =
    project === undefined || relative.toLowerCase().startsWith(`${project.toLowerCase()}/`)
      ? relative
      : yield* pagePath(`${project}/${relative}`)
  const projects = yield* projectFolders(vault)
  if (!isWritablePage(full, projects)) return yield* new InvalidError({ reason: "reserved_path" })
  if (Buffer.byteLength(write.body, "utf8") > maxBytes) return yield* new InvalidError({ reason: "too_large" })
  const properties = write.properties === undefined ? undefined : validProperties(write.properties)
  if (properties === null) return yield* new InvalidError({ reason: "invalid_properties" })
  const title = write.title?.trim()
  if (title !== undefined && [...title].length > titleLimit) return yield* new InvalidError({ reason: "invalid_title" })
  const target = yield* resolveInside(vault, full)
  const now = new Date().toISOString()

  if (write.create) {
    const source = encode(
      {
        id: `page_${ulid()}`,
        title: title || titleFromBody(write.body) || path.posix.basename(full, ".md"),
        updatedAt: now,
      },
      properties ?? {},
      write.body,
      false,
    )
    if (Buffer.byteLength(source, "utf8") > maxBytes) return yield* new InvalidError({ reason: "too_large" })
    yield* files
      .create({ target, content: source })
      .pipe(
        Effect.catchTag("FileMutation.TargetExistsError", () => Effect.fail(new ConflictError({ reason: "exists" }))),
      )
    return decode(full, source, projects)
  }

  const current = yield* readPageFile(vault, full, projects)
  if (write.expectedRevision !== undefined && write.expectedRevision !== current.revision)
    return yield* new ConflictError({ reason: "stale" })
  // Each save moves `updated_at` forward, so version names (keyed by it) stay in save order.
  const previous = Date.parse(current.info.updatedAt)
  const updatedAt =
    Number.isFinite(previous) && previous >= Date.parse(now) ? new Date(previous + 1).toISOString() : now
  const source = encode(
    { id: current.info.id, title: title || current.info.title, updatedAt },
    properties ?? current.data,
    write.body,
    current.bom,
  )
  if (Buffer.byteLength(source, "utf8") > maxBytes) return yield* new InvalidError({ reason: "too_large" })
  yield* keepVersion(vault, full, current)
  yield* files
    .writeIfUnchanged({ target, content: source, expected: current.bytes })
    .pipe(Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(new ConflictError({ reason: "stale" }))))
  return decode(full, source, projects)
})

/**
 * A page path inside a Project's folder, relative to the workspace folder (a path already inside it is
 * kept). A Project without a vault folder yet has no pages, so its paths read as missing.
 */
export const projectPagePath = Effect.fn("KnowledgeVault.projectPagePath")(function* (
  vault: Vault,
  projectId: string,
  input: string,
) {
  const relative = yield* pagePath(input)
  const folder = yield* existingProjectFolder(vault, projectId)
  if (folder === undefined) return yield* new NotFoundError({ path: relative })
  if (relative.toLowerCase().startsWith(`${folder.toLowerCase()}/`)) return relative
  return yield* pagePath(`${folder}/${relative}`)
})

/** Remove a page while it still has `expectedRevision`, keeping the removed version in its history. */
export const removePage = Effect.fn("KnowledgeVault.removePage")(function* (
  vault: Vault,
  input: string,
  expectedRevision: string,
) {
  const files = yield* FileMutation.Service
  const relative = yield* pagePath(input)
  const current = yield* readPageFile(vault, relative, yield* projectFolders(vault))
  if (current.revision !== expectedRevision) return yield* new ConflictError({ reason: "stale" })
  yield* keepVersion(vault, relative, current)
  yield* files.remove({ target: yield* resolveInside(vault, relative) })
})

/** Earlier versions of a page, newest first. */
export const pageHistory = Effect.fn("KnowledgeVault.pageHistory")(function* (vault: Vault, input: string) {
  return (yield* versions(vault, yield* pagePath(input))).slice(0, historyLimit).map((name) => ({
    revision: name,
    updatedAt: new Date(Number(name.slice(0, 13))).toISOString(),
  }))
})

export const pageVersion = Effect.fn("KnowledgeVault.pageVersion")(function* (
  vault: Vault,
  input: string,
  revision: string,
) {
  const relative = yield* pagePath(input)
  if (!revisionPattern.test(revision)) return yield* new InvalidError({ reason: "invalid_revision" })
  const target = yield* resolveInside(vault, `${historyFolder(relative)}/${revision}.md`)
  const bytes = yield* readSmall(target.canonical, maxBytes)
  if (bytes === undefined) return yield* new NotFoundError({ path: relative })
  return { revision, body: decode(relative, utf8.decode(bytes), new Map()).body }
})

/** The history route: the version list, or one version when `revision` is given. */
export const history = Effect.fn("KnowledgeVault.history")(function* (vault: Vault, input: string, revision?: string) {
  if (revision === undefined) return yield* pageHistory(vault, input)
  return yield* pageVersion(vault, input, revision)
})

export const readTimeline = Effect.fn("KnowledgeVault.readTimeline")(function* (vault: Vault, projectId: string) {
  const folder = yield* existingProjectFolder(vault, projectId)
  if (folder === undefined) return timeline(projectId, "new", [])
  const file = yield* timelineFile(vault, folder)
  return timeline(projectId, file.revision, file.items)
})

export const writeTimeline = Effect.fn("KnowledgeVault.writeTimeline")(function* (
  vault: Vault,
  projectId: string,
  input: TimelineWriteInput,
) {
  const files = yield* FileMutation.Service
  const items = validItems(input.items)
  if (items === undefined) return yield* new InvalidError({ reason: "invalid_timeline" })
  const folder = yield* ensureProjectFolder(vault, projectId)
  const file = yield* timelineFile(vault, folder)
  if (input.expectedRevision !== undefined && input.expectedRevision !== file.revision)
    return yield* new ConflictError({ reason: "stale" })
  const source = JSON.stringify({ version: 1, items }, null, 2) + "\n"
  yield* file.bytes === undefined
    ? files
        .create({ target: file.target, content: source })
        .pipe(
          Effect.catchTag("FileMutation.TargetExistsError", () => Effect.fail(new ConflictError({ reason: "stale" }))),
        )
    : files
        .writeIfUnchanged({ target: file.target, content: source, expected: file.bytes })
        .pipe(
          Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(new ConflictError({ reason: "stale" }))),
        )
  return timeline(projectId, hash(source), items)
})

/** Every machine's log of a Project, merged, newest first. */
export const readLog = Effect.fn("KnowledgeVault.readLog")(function* (vault: Vault, projectId: string) {
  const fs = yield* FSUtil.Service
  const folder = yield* existingProjectFolder(vault, projectId)
  if (folder === undefined) return []
  const logs = yield* resolveInside(vault, `${folder}/log`)
  const entries = yield* fs.readDirectoryEntries(logs.canonical).pipe(Effect.orElseSucceed(() => []))
  const parsed = yield* Effect.forEach(
    entries.filter((entry) => entry.type === "file" && entry.name.toLowerCase().endsWith(".md")),
    (entry) =>
      Effect.gen(function* () {
        const target = yield* resolveInside(vault, `${folder}/log/${entry.name}`)
        const bytes = yield* readSmall(target.canonical, maxBytes)
        return bytes === undefined ? [] : parseLog(utf8.decode(bytes), entry.name.slice(0, -3))
      }).pipe(Effect.orElseSucceed(() => [])),
    { concurrency: 8 },
  )
  return parsed
    .flat()
    .sort(
      (left, right) =>
        right.entry.at.localeCompare(left.entry.at) ||
        right.entry.machine.localeCompare(left.entry.machine) ||
        right.line - left.line,
    )
    .slice(0, logLimit)
    .map((item) => item.entry)
})

/** Append one line to this machine's own log file, so synced machines never edit the same file. */
export const appendLog = Effect.fn("KnowledgeVault.appendLog")(function* (
  vault: Vault,
  projectId: string,
  input: LogInput,
) {
  const fs = yield* FSUtil.Service
  const author = oneLine(input.author).replaceAll("·", "-")
  const text = oneLine(input.text)
  if (!author || [...author].length > 80) return yield* new InvalidError({ reason: "invalid_author" })
  if (!text || [...text].length > 4_000) return yield* new InvalidError({ reason: "invalid_text" })
  const folder = yield* ensureProjectFolder(vault, projectId)
  const target = yield* resolveInside(vault, `${folder}/log/${vault.machine}.md`)
  const entry = { at: new Date().toISOString(), author, text, machine: vault.machine }
  yield* fs.ensureDir(path.dirname(target.canonical))
  // Appending (no rename) keeps the file's identity, which sync clients merge best. An append follows
  // links, so anything but a regular file (or nothing) at the log path is refused first.
  yield* locks.withLock(`file:${target.canonical}`)(
    Effect.gen(function* () {
      const kind = yield* entryKind(target.canonical)
      if (kind !== "missing" && kind !== "file") return yield* new InvalidError({ reason: "not_a_file" })
      yield* fs.writeFileString(target.canonical, `- ${entry.at} · ${entry.author} · ${entry.text}\n`, {
        flag: "a",
      })
    }),
  )
  return entry
})

/** Remove one entry this machine appended (the last identical line); stale when it is no longer there. */
export const removeLogEntry = Effect.fn("KnowledgeVault.removeLogEntry")(function* (
  vault: Vault,
  projectId: string,
  entry: LogEntry,
) {
  const files = yield* FileMutation.Service
  if (entry.machine !== vault.machine) return yield* new ConflictError({ reason: "stale" })
  const folder = yield* existingProjectFolder(vault, projectId)
  if (folder === undefined) return yield* new ConflictError({ reason: "stale" })
  const target = yield* resolveInside(vault, `${folder}/log/${vault.machine}.md`)
  yield* locks.withLock(`file:${target.canonical}`)(
    Effect.gen(function* () {
      const bytes = yield* readSmall(target.canonical, maxBytes)
      const lines = bytes === undefined ? [] : utf8.decode(bytes).split("\n")
      const index = lines.lastIndexOf(`- ${entry.at} · ${entry.author} · ${entry.text}`)
      if (bytes === undefined || index < 0) return yield* new ConflictError({ reason: "stale" })
      yield* files
        .writeIfUnchanged({ target, content: lines.filter((_, line) => line !== index).join("\n"), expected: bytes })
        .pipe(
          Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(new ConflictError({ reason: "stale" }))),
        )
    }),
  )
})

/** Sync conflict copies (Dropbox, OneDrive, Syncthing style names) in the workspace's vault folder. */
export const conflicts = Effect.fn("KnowledgeVault.conflicts")(function* (vault: Vault) {
  const fs = yield* FSUtil.Service
  const files = yield* fs.glob("**/*", { cwd: vault.directory, absolute: false, include: "file", dot: false })
  return files
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => isConflictCopy(path.posix.basename(file)))
    .sort()
    .map((file) => ({ path: file, original: conflictOriginal(file) }))
})

/**
 * The file a conflict copy was made from: `Plan (conflicted copy 2026-11-02).md` → `Plan.md`, and
 * `Plan-DESKTOP-ABC123.md` → `Plan.md`.
 */
export function conflictOriginal(file: string) {
  const name = path.posix.basename(file)
  const original = name
    .replace(/\s*\([^()]*conflict[^()]*\)/i, "")
    .replace(/\.sync-conflict-[^.]*/i, "")
    .replace(oneDriveConflict, "")
    .trim()
  const directory = path.posix.dirname(file)
  return directory === "." ? original : `${directory}/${original}`
}

/**
 * Move notes written next to code into the vault: copy every note from `<workspace>/notes/**` and the
 * Project card folders, then back them up under `<root>/.backups/<timestamp>/`, then remove the
 * originals. Nothing is removed unless every copy and backup succeeded. Migrations of one workspace folder
 * run one at a time, so a caller that waited finds the notes already moved and moves nothing.
 */
export const migrate = Effect.fn("KnowledgeVault.migrate")(function* (vault: Vault) {
  return yield* locks.withLock(`migrate:${vault.directory}`)(migrateNotes(vault))
})

const migrateNotes = Effect.fnUntraced(function* (vault: Vault) {
  const fs = yield* FSUtil.Service
  const files = yield* FileMutation.Service
  const location = yield* Location.Service
  const mutation = yield* LocationMutation.Service
  const sources = (yield* fs.glob(
    "{notes/**/*.md,.tenon/projects/project_*/notes/**/*.md,projects/project_*/notes/**/*.md}",
    { cwd: location.directory, absolute: false, include: "file", dot: false },
  )).map((file) => file.replaceAll("\\", "/"))
  const read = yield* Effect.forEach(sources, (source) =>
    Effect.gen(function* () {
      const target = yield* mutation.resolve({ path: source, kind: "file" })
      const bytes = yield* readSmall(target.canonical, maxBytes)
      if (bytes === undefined) return undefined
      const projectId = yield* migratedProject(source, bytes)
      const project = projectId === undefined ? undefined : yield* ensureProjectFolder(vault, projectId)
      const relative = source.startsWith("notes/") ? source.slice("notes/".length) : source.split("/notes/")[1]
      const destination = yield* pagePath(project ? `${project}/${relative}` : relative)
      return { source, target, bytes, destination }
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Leaving a note that cannot be moved into the vault", {
          path: source,
          error: error._tag,
        }).pipe(Effect.as(undefined)),
      ),
    ),
  )
  const notes = read.filter((note) => note !== undefined)
  if (notes.length === 0) return { moved: 0, backup: null as string | null }

  yield* Effect.forEach(notes, (note) => copyInto(vault, note.destination, note.bytes), { discard: true })
  const backup = `.backups/${new Date().toISOString().replace(/[:.]/g, "-")}`
  // Backups sit beside the workspace folders, so they are contained by the real vault root.
  const root = yield* fs.realPath(vault.root)
  yield* Effect.forEach(
    notes,
    (note) =>
      resolveUnder(root, `${backup}/${vault.folder}/${note.source}`).pipe(
        Effect.flatMap((target) => files.create({ target, content: note.bytes })),
      ),
    { discard: true },
  )
  yield* Effect.forEach(notes, (note) => files.remove({ target: note.target }), { discard: true })
  // Remove folders the move emptied, deepest first; rmdir leaves any folder that still holds something.
  const folders = [...new Set(notes.flatMap((note) => parents(note.source)))].sort((a, b) => b.length - a.length)
  yield* Effect.forEach(
    folders,
    (folder) => Effect.tryPromise(() => rmdir(path.join(location.directory, ...folder.split("/")))).pipe(Effect.ignore),
    { discard: true },
  )
  yield* Effect.logInfo("Moved notes into the Tenon vault", { count: notes.length })
  return { moved: notes.length, backup }
})

// ---- workspace folders and the machine map ----

const Machine = Schema.Struct({
  version: Schema.Literal(1),
  machine: Schema.String,
  /** vault root → workspace directory → workspace id. Lives in app data, never in the vault. */
  roots: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
})
type Machine = typeof Machine.Type

const WorkspaceFile = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  name: Schema.String,
  repository: Schema.optional(Schema.String),
})

const ProjectFile = Schema.Struct({ version: Schema.Literal(1), id: Schema.String, name: Schema.String })

/** The stored map, without writing. Only a missing file reads as absent; other read errors fail, since a reset would lose it. */
const loadMachine = Effect.fnUntraced(function* () {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const file = path.join(global.data, "vault-machine.json")
  const source = yield* fs
    .readFileString(file)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  const decoded =
    source === undefined ? Option.none() : Schema.decodeUnknownOption(Schema.fromJsonString(Machine))(source)
  const machine = Option.isSome(decoded) && machinePattern.test(decoded.value.machine) ? decoded.value : undefined
  return { file, damaged: source !== undefined && machine === undefined, machine }
})

const readMachine = Effect.fnUntraced(function* () {
  const fs = yield* FSUtil.Service
  const stored = yield* loadMachine()
  if (stored.machine !== undefined) return stored.machine
  if (stored.damaged) {
    yield* Effect.logWarning("Keeping a damaged vault machine map aside")
    yield* fs
      .rename(stored.file, `${stored.file}.corrupt-${Date.now()}`)
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void))
  }
  const machine: Machine = { version: 1, machine: machineName(os.hostname()), roots: {} }
  yield* writeMachine(machine)
  return machine
})

const writeMachine = Effect.fnUntraced(function* (machine: Machine) {
  const files = yield* FileMutation.Service
  const global = yield* Global.Service
  const canonical = path.join(global.data, "vault-machine.json")
  yield* files.write({ target: { canonical, resource: canonical }, content: JSON.stringify(machine, null, 2) + "\n" })
})

const machinePattern = /^[A-Za-z0-9-]{1,60}$/

/** A readable, file-safe machine id: the host name plus a random suffix so two hosts never share a log. */
export function machineName(host: string) {
  const base =
    host
      .replace(/[^A-Za-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "machine"
  return `${base}-${randomBytes(3).toString("hex")}`
}

const workspaceFolders = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FSUtil.Service
  const entries = yield* fs.readDirectoryEntries(root).pipe(Effect.orElseSucceed(() => []))
  const folders = yield* Effect.forEach(
    entries.filter((entry) => entry.type === "directory" && !entry.name.startsWith(".")),
    (entry) =>
      readIdFile(path.join(root, entry.name, "workspace.json")).pipe(
        Effect.map((source) => {
          if (source === undefined) return undefined
          const file = Schema.decodeUnknownOption(Schema.fromJsonString(WorkspaceFile))(source)
          return Option.isSome(file) ? { folder: entry.name, ...file.value } : undefined
        }),
      ),
    { concurrency: 8 },
  )
  return folders.filter((folder) => folder !== undefined)
})

const createWorkspaceFolder = Effect.fnUntraced(function* (
  root: string,
  workspace: Workspace,
  known: string | undefined,
  existing: ReadonlyArray<{ folder: string }>,
) {
  const fs = yield* FSUtil.Service
  const files = yield* FileMutation.Service
  const entries = yield* fs.readDirectoryEntries(root).pipe(Effect.orElseSucceed(() => []))
  const name = [...(workspace.name.trim() || "Workspace")].slice(0, titleLimit).join("")
  const folder = uniqueFolder(BrainProject.folderName(name), [
    ...entries.map((entry) => entry.name),
    ...existing.map((item) => item.folder),
  ])
  const id = known ?? `workspace_${ulid()}`
  const content = {
    version: 1 as const,
    id,
    name,
    ...(workspace.repository ? { repository: workspace.repository } : {}),
  }
  const canonical = path.join(root, folder, "workspace.json")
  yield* files.create({ target: { canonical, resource: canonical }, content: JSON.stringify(content, null, 2) + "\n" })
  return { folder, ...content }
})

function uniqueFolder(base: string, taken: ReadonlyArray<string>) {
  const lower = new Set(taken.map((name) => name.toLowerCase()))
  for (let index = 1; ; index++) {
    const candidate = index === 1 ? base : `${base} (${index})`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

// ---- Project folders ----

/** Project id → folder name, from each top-level folder's `project.json`. */
const projectFolders = Effect.fnUntraced(function* (vault: Vault) {
  const fs = yield* FSUtil.Service
  const entries = yield* fs.readDirectoryEntries(vault.directory).pipe(Effect.orElseSucceed(() => []))
  const found = yield* Effect.forEach(
    entries.filter((entry) => entry.type === "directory" && !entry.name.startsWith(".")),
    (entry) =>
      readIdFile(path.join(vault.directory, entry.name, "project.json")).pipe(
        Effect.map((source) => {
          if (source === undefined) return undefined
          const file = Schema.decodeUnknownOption(Schema.fromJsonString(ProjectFile))(source)
          return Option.isSome(file) && projectPattern.test(file.value.id)
            ? ([file.value.id, entry.name] as const)
            : undefined
        }),
      ),
    { concurrency: 8 },
  )
  return new Map(found.filter((item) => item !== undefined))
})

const existingProjectFolder = Effect.fnUntraced(function* (vault: Vault, projectId: string) {
  if (!projectPattern.test(projectId)) return yield* new InvalidError({ reason: "invalid_project" })
  const folder = (yield* projectFolders(vault)).get(projectId)
  // A Project without a vault folder yet must still exist in the workspace.
  if (folder === undefined) yield* BrainProject.get(projectId)
  return folder
})

/** The Project's readable folder in the vault, created (named after the Project) on first use. */
const ensureProjectFolder = Effect.fnUntraced(function* (vault: Vault, projectId: string) {
  const existing = yield* existingProjectFolder(vault, projectId)
  if (existing !== undefined) return existing
  const project = yield* BrainProject.get(projectId)
  return yield* locks.withLock(`workspace:${vault.directory}`)(
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const files = yield* FileMutation.Service
      const again = (yield* projectFolders(vault)).get(projectId)
      if (again !== undefined) return again
      const entries = yield* fs.readDirectoryEntries(vault.directory).pipe(Effect.orElseSucceed(() => []))
      const folder = uniqueFolder(
        BrainProject.folderName(project.name),
        entries.map((entry) => entry.name),
      )
      const canonical = path.join(vault.directory, folder, "project.json")
      yield* files.create({
        target: { canonical, resource: `${folder}/project.json` },
        content: JSON.stringify({ version: 1, id: projectId, name: project.name }, null, 2) + "\n",
      })
      return folder
    }),
  )
})

// ---- pages ----

/**
 * A page path relative to the workspace folder: `/`-separated, ending in `.md`, without empty, dot, `..`
 * or hidden segments, absolute or drive paths, backslashes, characters Windows refuses, or reserved names.
 */
export function isPagePath(value: string) {
  if (!value || value.length > pathLimit || !value.toLowerCase().endsWith(".md")) return false
  if (value.includes("\\") || value.startsWith("/") || /[\u0000-\u001f<>:"|?*]/.test(value)) return false
  return value
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        [...segment].length <= segmentLimit &&
        !segment.startsWith(".") &&
        !/[. ]$/.test(segment) &&
        segment.trim() === segment &&
        !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(segment),
    )
}

const pagePath = (value: string) =>
  isPagePath(value) ? Effect.succeed(value) : Effect.fail(new InvalidError({ reason: "invalid_path" }))

/** Listed pages skip machine logs and sync conflict copies (shown by `conflicts`). */
function isListedPage(file: string, projects: ReadonlyMap<string, string>) {
  return isPagePath(file) && isWritablePage(file, projects) && !isConflictCopy(path.posix.basename(file))
}

function isWritablePage(file: string, projects: ReadonlyMap<string, string>) {
  const segments = file.split("/")
  const folders = new Set([...projects.values()].map((folder) => folder.toLowerCase()))
  return !(segments.length > 2 && folders.has(segments[0].toLowerCase()) && segments[1].toLowerCase() === "log")
}

type PageFile = Page & { data: Record<string, unknown>; bom: boolean }

const readPageFile = Effect.fnUntraced(function* (
  vault: Vault,
  relative: string,
  projects: ReadonlyMap<string, string>,
) {
  const target = yield* resolveInside(vault, relative)
  const bytes = yield* readSmall(target.canonical, maxBytes)
  if (bytes === undefined) return yield* new NotFoundError({ path: relative })
  const page = yield* Effect.try({
    try: () => decode(relative, utf8.decode(bytes), projects),
    catch: () => new InvalidError({ reason: "invalid_page" }),
  })
  return { ...page, bytes }
})

function decode(relative: string, raw: string, projects: ReadonlyMap<string, string>): PageFile {
  const bom = raw.startsWith("﻿")
  // Untrusted Markdown: never evaluates `---js` front matter and caps its size.
  const parsed = Frontmatter.parse(bom ? raw.slice(1) : raw)
  const data = { ...(parsed.data as Record<string, unknown>) }
  const top = relative.split("/")[0].toLowerCase()
  const projectId = relative.includes("/")
    ? ([...projects].find(([, folder]) => folder.toLowerCase() === top)?.[0] ?? null)
    : null
  const title = typeof data.title === "string" ? data.title.trim() : ""
  return {
    info: {
      id:
        typeof data.id === "string" && /^[\w-]{1,64}$/.test(data.id) ? data.id : `page_${hash(relative).slice(0, 26)}`,
      path: relative,
      title: [...(title || titleFromBody(parsed.content) || path.posix.basename(relative, ".md"))]
        .slice(0, titleLimit)
        .join(""),
      projectId,
      properties: Object.fromEntries(
        Object.entries(data)
          .filter(([key]) => !reservedKeys.has(key))
          .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
      ),
      // Front matter is hand-editable; a date that does not parse reads as "" (unknown) rather than as text.
      updatedAt:
        typeof data.updated_at === "string" && Number.isFinite(Date.parse(data.updated_at))
          ? data.updated_at
          : data.updated_at instanceof Date && Number.isFinite(data.updated_at.getTime())
            ? data.updated_at.toISOString()
            : "",
    },
    body: parsed.content,
    revision: hash(raw),
    data,
    bom,
  }
}

function encode(
  head: { id: string; title: string; updatedAt: string },
  properties: Record<string, unknown>,
  body: string,
  bom: boolean,
) {
  const rest = Object.fromEntries(Object.entries(properties).filter(([key]) => !reservedKeys.has(key)))
  // An object, not a string: gray-matter parses a string first, so a body opening with its own front
  // matter would merge into the page's properties, and a `---js` block would be evaluated.
  const source = matter.stringify(
    { content: body },
    { id: head.id, title: head.title, ...rest, updated_at: head.updatedAt },
    {},
  )
  return bom ? `﻿${source}` : source
}

/** Front matter properties: simple keys and JSON scalars or lists of them; null when invalid. */
function validProperties(properties: Record<string, unknown>) {
  const scalar = (value: unknown) =>
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  const entries = Object.entries(properties)
  if (entries.length > 64 || JSON.stringify(properties).length > 16 * 1024) return null
  const valid = entries.every(
    ([key, value]) =>
      /^[A-Za-z_][\w-]{0,63}$/.test(key) &&
      !reservedKeys.has(key) &&
      (scalar(value) || (Array.isArray(value) && value.length <= 100 && value.every(scalar))),
  )
  return valid ? properties : null
}

// ---- history ----

function historyFolder(relative: string) {
  return `.history/${relative.slice(0, -3)}`
}

const versions = Effect.fnUntraced(function* (vault: Vault, relative: string) {
  const fs = yield* FSUtil.Service
  const folder = yield* resolveInside(vault, historyFolder(relative))
  const entries = yield* fs.readDirectoryEntries(folder.canonical).pipe(Effect.orElseSucceed(() => []))
  return entries
    .filter(
      (entry) => entry.type === "file" && entry.name.endsWith(".md") && revisionPattern.test(entry.name.slice(0, -3)),
    )
    .map((entry) => entry.name.slice(0, -3))
    .sort()
    .reverse()
})

/** Copy the version about to be overwritten into `.history`, keeping the newest 20. */
const keepVersion = Effect.fnUntraced(function* (
  vault: Vault,
  relative: string,
  current: PageFile & { bytes: Uint8Array },
) {
  const files = yield* FileMutation.Service
  const time = Date.parse(current.info.updatedAt)
  const name = `${String(Number.isFinite(time) ? time : Date.now()).padStart(13, "0")}-${current.revision.slice(0, 16)}`
  const target = yield* resolveInside(vault, `${historyFolder(relative)}/${name}.md`)
  yield* files
    .create({ target, content: current.bytes })
    .pipe(Effect.catchTag("FileMutation.TargetExistsError", () => Effect.void))
  const old = (yield* versions(vault, relative)).slice(historyLimit)
  yield* Effect.forEach(
    old,
    (version) =>
      resolveInside(vault, `${historyFolder(relative)}/${version}.md`).pipe(
        Effect.flatMap((stale) => files.remove({ target: stale })),
      ),
    { discard: true },
  )
})

// ---- timeline and log ----

const TimelineFile = Schema.Struct({ version: Schema.Literal(1), items: Schema.Array(TimelineItem) })

const timelineFile = Effect.fnUntraced(function* (vault: Vault, folder: string) {
  const target = yield* resolveInside(vault, `${folder}/timeline.json`)
  const bytes = yield* readSmall(target.canonical, maxBytes)
  if (bytes === undefined) return { target, bytes, revision: "new", items: [] as TimelineItem[] }
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(TimelineFile))(utf8.decode(bytes))
  // A damaged file reads as empty; its revision still guards it, so a save replaces it knowingly.
  if (Option.isNone(decoded)) yield* Effect.logWarning("Unreadable vault timeline", { folder })
  return {
    target,
    bytes,
    revision: hash(utf8.decode(bytes)),
    items: Option.match(decoded, { onNone: () => [], onSome: (file) => [...file.items] }),
  }
})

function timeline(projectId: string, revision: string, items: ReadonlyArray<TimelineItem>): Timeline {
  const tasks = items.filter((item) => item.kind === "task")
  return {
    projectId,
    revision,
    items: [...items],
    progress: tasks.length === 0 ? 0 : tasks.filter((item) => item.status === "done").length / tasks.length,
  }
}

function validItems(items: ReadonlyArray<TimelineItem>) {
  const date = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/
  const cleaned = items.map((item) => ({
    id: item.id,
    title: item.title.trim(),
    kind: item.kind,
    status: item.status,
    ...(item.start ? { start: item.start } : {}),
    ...(item.end ? { end: item.end } : {}),
  }))
  const valid =
    cleaned.length <= 1_000 &&
    new Set(cleaned.map((item) => item.id)).size === cleaned.length &&
    cleaned.every(
      (item) =>
        /^[\w-]{1,64}$/.test(item.id) &&
        item.title.length > 0 &&
        [...item.title].length <= titleLimit &&
        [item.start, item.end].every((value) => value === undefined || date.test(value)),
    )
  return valid ? cleaned : undefined
}

function oneLine(value: string) {
  return value.replace(/\s*[\r\n]+\s*/g, " ").trim()
}

export function parseLog(source: string, machine: string) {
  return source.split(/\r?\n/).flatMap((line, index) => {
    const match = /^- (\d{4}-\d{2}-\d{2}T\S+) · (.*?) · (.*)$/.exec(line)
    return match ? [{ line: index, entry: { at: match[1], author: match[2], text: match[3], machine } }] : []
  })
}

// ---- migration ----

/** The Project a moved note belongs to: its card folder, or the first known id in its `project_ids`. */
const migratedProject = Effect.fnUntraced(function* (source: string, bytes: Uint8Array) {
  const card = /^(?:\.tenon\/)?projects\/(project_[0-9A-Z]+)\/notes\//i.exec(source)?.[1]
  if (card) return card
  const ids = yield* Effect.try({
    try: () => {
      const data = Frontmatter.parse(utf8.decode(bytes)).data as Record<string, unknown>
      return Array.isArray(data.project_ids)
        ? data.project_ids.filter((id): id is string => typeof id === "string" && projectPattern.test(id))
        : []
    },
    catch: () => new InvalidError({ reason: "invalid_page" }),
  }).pipe(Effect.orElseSucceed((): string[] => []))
  for (const id of ids) {
    if (
      yield* BrainProject.get(id).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
    )
      return id
  }
  return undefined
})

/** Copy into the vault; an identical page is reused, a different one gets ` (migrated)` in its name. */
const copyInto = Effect.fnUntraced(function* (vault: Vault, destination: string, bytes: Uint8Array) {
  const files = yield* FileMutation.Service
  for (let index = 1; ; index++) {
    const stem = destination.slice(0, -3)
    const candidate = index === 1 ? destination : `${stem} (migrated${index === 2 ? "" : ` ${index - 1}`}).md`
    const target = yield* resolveInside(vault, candidate)
    const existing = yield* readSmall(target.canonical, maxBytes)
    if (existing !== undefined && Buffer.from(existing).equals(Buffer.from(bytes))) return candidate
    if (existing !== undefined) continue
    const created = yield* files.create({ target, content: bytes }).pipe(
      Effect.as(true),
      Effect.catchTag("FileMutation.TargetExistsError", () => Effect.succeed(false)),
    )
    if (created) return candidate
  }
})

function parents(file: string) {
  const segments = file.split("/").slice(0, -1)
  const stop = segments.indexOf("notes")
  return segments.flatMap((_, index) => (index >= stop ? [segments.slice(0, index + 1).join("/")] : []))
}

// ---- shared helpers ----

/**
 * Resolve a validated relative path inside the workspace's vault folder. The nearest existing ancestor
 * is resolved through symlinks, so a link inside the vault cannot lead a read or write outside it.
 */
const resolveInside = (vault: Vault, relative: string) => resolveUnder(vault.directory, relative)

/**
 * Resolve `relative` under the canonical folder `base`. The walk stops at the nearest entry that exists
 * without following links, so a dangling symlink is caught too: its target must resolve inside `base`.
 */
const resolveUnder = Effect.fnUntraced(function* (base: string, relative: string) {
  const fs = yield* FSUtil.Service
  const absolute = path.join(base, ...relative.split("/"))
  let anchor = absolute
  while (anchor !== base && (yield* entryKind(anchor)) === "missing") {
    const parent = path.dirname(anchor)
    if (parent === anchor) break
    anchor = parent
  }
  const real = yield* fs.realPath(anchor).pipe(Effect.mapError(() => new InvalidError({ reason: "outside_vault" })))
  if (!FSUtil.contains(base, real)) return yield* new InvalidError({ reason: "outside_vault" })
  return { canonical: path.join(real, path.relative(anchor, absolute)), resource: relative }
})

/** What sits at `file` without following a final symlink. */
const entryKind = (file: string) =>
  Effect.tryPromise(() => lstat(file)).pipe(
    Effect.map((stat) =>
      stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
    ),
    Effect.orElseSucceed(() => "missing" as const),
  )

/** File bytes, or undefined when missing; files above `limit` are refused before reading. */
const readSmall = Effect.fnUntraced(function* (file: string, limit: number) {
  const fs = yield* FSUtil.Service
  const stat = yield* fs
    .stat(file)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (stat === undefined) return undefined
  if (stat.type !== "File") return yield* new InvalidError({ reason: "not_a_file" })
  if (Number(stat.size) > limit) return yield* new InvalidError({ reason: "too_large" })
  return yield* fs.readFile(file).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
})

/** A small id file's text, or undefined when it is missing or unreadable. */
const readIdFile = (file: string) =>
  readSmall(file, smallFileLimit).pipe(
    Effect.map((bytes) => (bytes === undefined ? undefined : utf8.decode(bytes))),
    Effect.orElseSucceed(() => undefined),
  )

function hash(source: string) {
  return createHash("sha256").update(source).digest("hex")
}
