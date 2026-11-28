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
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { lstat, readdir, readFile, rmdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ulid } from "ulid"
import { BrainProject } from "../project/brain"
import { WikiLinks } from "./wiki-links"

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
const oneDriveConflict = /-(?:DESKTOP|LAPTOP)-[A-Z0-9]{4,}(?:-\d+)?(?=\.[^.]+$|$)/
const isConflictCopy = (name: string) => conflictPattern.test(name) || oneDriveConflict.test(name)
const sameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true })
const locks = KeyedMutex.makeUnsafe<string>()
const foldName = (value: string) => value.normalize("NFC").toLowerCase()

export const WorkspaceInfo = Schema.Struct({ id: Schema.String, name: Schema.String, folder: Schema.String })
export const Info = Schema.Struct({ root: Schema.String, workspace: WorkspaceInfo })
export type Info = typeof Info.Type

export const Properties = Schema.Record(Schema.String, Schema.Unknown)

export const PageInfo = Schema.Struct({
  id: Schema.String,
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
  projectId: Schema.optional(Schema.String),
  properties: Schema.optional(Properties),
  expectedRevision: Schema.optional(Schema.String),
  create: Schema.optional(Schema.Boolean),
})
export type PageWriteInput = typeof PageWriteInput.Type

export const Backlink = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  snippet: Schema.String,
})
export type Backlink = typeof Backlink.Type

export const PageMoveInput = Schema.Struct({
  path: Schema.String,
  expectedRevision: Schema.String,
  title: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
})
export type PageMoveInput = typeof PageMoveInput.Type

export const PageMoveResult = Schema.Struct({ page: Page, updatedLinks: Schema.Number })
export type PageMoveResult = typeof PageMoveResult.Type

export const PageSearchHit = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  snippet: Schema.String,
})
export type PageSearchHit = typeof PageSearchHit.Type

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
  backup: Schema.NullOr(Schema.String),
})
export type MigrateResult = typeof MigrateResult.Type

export class InvalidError extends Schema.TaggedError<InvalidError>()("KnowledgeVault.InvalidError", {
  reason: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("KnowledgeVault.NotFoundError", {
  path: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()("KnowledgeVault.ConflictError", {
  reason: Schema.String,
}) {}

export interface Workspace {
  readonly directory: string
  readonly name: string
  readonly repository?: string
}

export interface Vault {
  readonly root: string
  readonly folder: string
  readonly directory: string
  readonly id: string
  readonly name: string
  readonly machine: string
}

export function rootFor(env: Record<string, string | undefined>, home: string, api: path.PlatformPath = path) {
  const chosen = env.TENON_VAULT_DIR?.trim()
  return api.resolve(chosen || api.join(home, "Documents", "Tenon"))
}

export function rootInside(root: string, folders: ReadonlyArray<string>, api: path.PlatformPath = path) {
  const fold = (value: string) => (api === path.win32 ? value.toLowerCase() : value)
  return folders.some((folder) => {
    const relative = api.relative(fold(api.resolve(folder)), fold(api.resolve(root)))
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative))
  })
}

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
      const scan = yield* workspaceFolders(root)
      const folders = scan.found
      const known =
        mapped ??
        Object.values(machine.roots)
          .map((directories) => directories[workspace.directory])
          .find((id) => id !== undefined && folders.some((item) => item.id === id))
      const found =
        folders.find((item) => known !== undefined && item.id === known) ??
        (workspace.repository ? folders.find((item) => item.repository === workspace.repository) : undefined)
      const expected =
        workspace.repository !== undefined ||
        Object.values(machine.roots).some((directories) => directories[workspace.directory] !== undefined)
      if (found === undefined && expected && scan.unreadable.length > 0) return yield* unavailable(scan.unreadable[0])
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

export const knownWorkspaces = Effect.fn("KnowledgeVault.knownWorkspaces")(function* () {
  const { machine } = yield* loadMachine()
  if (machine === undefined) return []
  return [...new Set(Object.values(machine.roots).flatMap((directories) => Object.keys(directories)))]
})

export function machineRoots(data: string): Machine["roots"] {
  try {
    const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Machine))(
      readFileSync(path.join(data, "vault-machine.json"), "utf8"),
    )
    return Option.isSome(decoded) ? decoded.value.roots : {}
  } catch {
    return {}
  }
}

export function workspacesUnder(roots: Machine["roots"], root: string, ids: ReadonlySet<string>) {
  const directories = Object.entries(roots).flatMap(([key, mapped]) =>
    Object.entries(mapped)
      .filter(([, id]) => key === root || ids.has(id))
      .map(([directory]) => directory),
  )
  return [...new Set(directories)]
}

export async function currentWorkspaces(root: string, data: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const ids = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) =>
        readFile(path.join(root, entry.name, "workspace.json"), "utf8")
          .then((source) => Schema.decodeUnknownOption(Schema.fromJsonString(WorkspaceFile))(source))
          .then((file) => (Option.isSome(file) ? file.value.id : undefined))
          .catch(() => undefined),
      ),
  )
  return workspacesUnder(machineRoots(data), root, new Set(ids.filter((id) => id !== undefined)))
}

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
  const byFolder = projectFolderIndex(yield* projectFolders(vault))
  const files = yield* fs.glob("**/*.md", { cwd: vault.directory, absolute: false, include: "file", dot: false })
  const query = filter.search?.trim().toLowerCase() ?? ""
  const pages = yield* Effect.forEach(
    files
      .map((file) => file.replaceAll("\\", "/"))
      .filter(
        (file) =>
          isListedPage(file, byFolder) &&
          (filter.project === undefined || projectOfFolder(file, byFolder) === filter.project),
      ),
    (file) =>
      listedPage(vault, file, byFolder, query !== "").pipe(
        Effect.map((page) => (!query || page.text?.includes(query) ? page.info : undefined)),
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

export const folderPages = Effect.fn("KnowledgeVault.folderPages")(function* (vault: Vault, name: string) {
  const fs = yield* FSUtil.Service
  const entries = yield* fs.readDirectoryEntries(vault.directory).pipe(Effect.orElseSucceed(() => []))
  const folders = entries.filter((entry) => entry.type === "directory" && sameName(entry.name, name))
  if (folders.length === 0) return [] as Page[]
  const projects = yield* projectFolders(vault)
  const byFolder = projectFolderIndex(projects)
  const files = yield* Effect.forEach(folders, (folder) =>
    fs
      .glob("**/*.md", { cwd: path.join(vault.directory, folder.name), absolute: false, include: "file", dot: false })
      .pipe(Effect.map((found) => found.map((file) => `${folder.name}/${file.replaceAll("\\", "/")}`))),
  )
  const pages = yield* Effect.forEach(
    files.flat().filter((file) => isListedPage(file, byFolder)),
    (file) =>
      readPageFile(vault, file, projects, byFolder).pipe(
        Effect.map((page): Page => ({ info: page.info, body: page.body, revision: page.revision })),
        Effect.catch((error) =>
          Effect.logWarning("Skipping unreadable vault page", { path: file, error: error._tag }).pipe(
            Effect.as(undefined),
          ),
        ),
      ),
    { concurrency: 8 },
  )
  return pages.filter((page): page is Page => page !== undefined)
})

export async function workspacesWithFolder(root: string, name: string) {
  const ids = new Set<string>()
  const folders = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    folders
      .filter((folder) => folder.isDirectory() && !folder.name.startsWith("."))
      .map(async (folder) => {
        const directory = path.join(root, folder.name)
        const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
        if (!entries.some((entry) => entry.isDirectory() && sameName(entry.name, name))) return
        const source = await readFile(path.join(directory, "workspace.json"), "utf8").catch(() => undefined)
        if (source === undefined) return
        const file = Schema.decodeUnknownOption(Schema.fromJsonString(WorkspaceFile))(source)
        if (Option.isSome(file)) ids.add(file.value.id)
      }),
  )
  return ids
}

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
  const inside = project === undefined ? relative : yield* pagePath(insideFolder(relative, project))
  const projects = yield* projectFolders(vault)
  const byFolder = projectFolderIndex(projects)
  const full = write.create ? newPagePath(inside, projects) : inside
  if (full === undefined) return yield* new InvalidError({ reason: "invalid_path" })
  if (!isWritablePageFolder(full, byFolder)) return yield* new InvalidError({ reason: "reserved_path" })
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
    forgetPage(target.canonical)
    return decode(full, source, byFolder)
  }

  const current = yield* readPageFile(vault, full, projects, byFolder)
  if (write.expectedRevision !== undefined && write.expectedRevision !== current.revision)
    return yield* new ConflictError({ reason: "stale" })
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
  forgetPage(target.canonical)
  return decode(full, source, byFolder)
})

export const projectPagePath = Effect.fn("KnowledgeVault.projectPagePath")(function* (
  vault: Vault,
  projectId: string,
  input: string,
) {
  const relative = yield* pagePath(input)
  const folder = yield* existingProjectFolder(vault, projectId)
  if (folder === undefined) return yield* new NotFoundError({ path: relative })
  return yield* pagePath(insideFolder(relative, folder))
})

export const removePage = Effect.fn("KnowledgeVault.removePage")(function* (
  vault: Vault,
  input: string,
  expectedRevision: string,
) {
  const files = yield* FileMutation.Service
  const relative = yield* pagePath(input)
  const projects = yield* projectFolders(vault)
  if (!isWritablePage(relative, projects)) return yield* new InvalidError({ reason: "reserved_path" })
  const current = yield* readPageFile(vault, relative, projects)
  if (current.revision !== expectedRevision) return yield* new ConflictError({ reason: "stale" })
  yield* keepVersion(vault, relative, current)
  const target = yield* resolveInside(vault, relative)
  yield* files.remove({ target })
  forgetPage(target.canonical)
})

const everyPage = Effect.fnUntraced(function* (vault: Vault, projects: ReadonlyMap<string, string>) {
  const fs = yield* FSUtil.Service
  const byFolder = projectFolderIndex(projects)
  const files = yield* fs.glob("**/*.md", { cwd: vault.directory, absolute: false, include: "file", dot: false })
  const pages = yield* Effect.forEach(
    files.map((file) => file.replaceAll("\\", "/")).filter((file) => isListedPage(file, byFolder)),
    (file) =>
      readPageFile(vault, file, projects, byFolder).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Skipping unreadable vault page", { path: file, error: error._tag }).pipe(
            Effect.as(undefined),
          ),
        ),
      ),
    { concurrency: 8 },
  )
  return pages.filter((page) => page !== undefined)
})

export const backlinks = Effect.fn("KnowledgeVault.backlinks")(function* (vault: Vault, input: string) {
  const relative = yield* pagePath(input)
  const projects = yield* projectFolders(vault)
  const target = yield* readPageFile(vault, relative, projects)
  const keys = WikiLinks.pageKeys(target.info)
  const pages = yield* everyPage(vault, projects)
  return pages
    .filter((page) => page.info.path !== relative)
    .flatMap((page): Backlink[] => {
      const link = WikiLinks.links(page.body).find((item) => keys.has(item.key))
      if (!link) return []
      return [
        {
          path: page.info.path,
          title: page.info.title,
          projectId: page.info.projectId,
          snippet: WikiLinks.snippet(page.body, link.index, link.length),
        },
      ]
    })
    .sort((left, right) => left.title.localeCompare(right.title) || left.path.localeCompare(right.path))
    .slice(0, pageLimit)
})

export const searchPages = Effect.fn("KnowledgeVault.searchPages")(function* (
  vault: Vault,
  query: string,
  limit: number,
) {
  const needle = query.trim().toLowerCase()
  if (!needle) return [] as PageSearchHit[]
  const projects = yield* projectFolders(vault)
  const pages = yield* everyPage(vault, projects)
  return pages
    .flatMap((page): Array<PageSearchHit & { rank: number; updatedAt: string }> => {
      const inTitle = page.info.title.toLowerCase().indexOf(needle)
      const inBody = page.body.toLowerCase().indexOf(needle)
      if (inTitle < 0 && inBody < 0) return []
      return [
        {
          path: page.info.path,
          title: page.info.title,
          projectId: page.info.projectId,
          snippet:
            inBody < 0 ? WikiLinks.snippet(page.body, 0, 0, 80) : WikiLinks.snippet(page.body, inBody, needle.length),
          rank: inTitle < 0 ? 1 : 0,
          updatedAt: page.info.updatedAt,
        },
      ]
    })
    .sort((left, right) => left.rank - right.rank || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map(({ rank: _rank, updatedAt: _updatedAt, ...hit }) => hit)
})

const fileNameFor = (title: string) => {
  const name = title
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
  return name ? `${[...name].slice(0, segmentLimit - 3).join("")}.md` : undefined
}

const moveHistory = Effect.fnUntraced(function* (vault: Vault, from: string, to: string) {
  const files = yield* FileMutation.Service
  const fs = yield* FSUtil.Service
  for (const version of yield* versions(vault, from)) {
    const source = yield* resolveInside(vault, `${historyFolder(from)}/${version}.md`)
    const bytes = yield* fs.readFile(source.canonical).pipe(Effect.option)
    if (Option.isNone(bytes)) continue
    const target = yield* resolveInside(vault, `${historyFolder(to)}/${version}.md`)
    yield* files
      .create({ target, content: bytes.value })
      .pipe(Effect.catchTag("FileMutation.TargetExistsError", () => Effect.void))
    yield* files.remove({ target: source })
  }
})

export const movePage = Effect.fn("KnowledgeVault.movePage")(function* (vault: Vault, input: PageMoveInput) {
  const files = yield* FileMutation.Service
  const relative = yield* pagePath(input.path)
  const projects = yield* projectFolders(vault)
  if (!isWritablePage(relative, projects)) return yield* new InvalidError({ reason: "reserved_path" })
  const current = yield* readPageFile(vault, relative, projects)
  if (current.revision !== input.expectedRevision) return yield* new ConflictError({ reason: "stale" })
  const title = input.title === undefined ? current.info.title : input.title.trim()
  if (!title || [...title].length > titleLimit) return yield* new InvalidError({ reason: "invalid_title" })
  const name = input.title === undefined ? path.posix.basename(relative) : fileNameFor(title)
  if (name === undefined) return yield* new InvalidError({ reason: "invalid_title" })
  const here = path.posix.dirname(relative)
  const folder =
    input.projectId === undefined
      ? here === "."
        ? ""
        : here
      : input.projectId === null
        ? ""
        : yield* ensureProjectFolder(vault, input.projectId)
  const next = folder ? `${folder}/${name}` : name
  const after = yield* projectFolders(vault)
  const byFolder = projectFolderIndex(after)
  if (!isPagePath(next) || !isWritablePageFolder(next, byFolder))
    return yield* new InvalidError({ reason: "invalid_path" })
  const samePlace = foldName(next) === foldName(relative)
  if (samePlace && title === current.info.title) return yield* new InvalidError({ reason: "unchanged" })
  const source = encode(
    { id: current.info.id, title, updatedAt: new Date().toISOString() },
    current.data,
    current.body,
    current.bom,
  )
  const from = yield* resolveInside(vault, relative)
  if (samePlace) {
    yield* files
      .writeIfUnchanged({ target: from, content: source, expected: current.bytes })
      .pipe(
        Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(new ConflictError({ reason: "stale" }))),
      )
    forgetPage(from.canonical)
  } else {
    const target = yield* resolveInside(vault, next)
    yield* files
      .create({ target, content: source })
      .pipe(
        Effect.catchTag("FileMutation.TargetExistsError", () => Effect.fail(new ConflictError({ reason: "exists" }))),
      )
    yield* files.remove({ target: from })
    forgetPage(from.canonical)
    forgetPage(target.canonical)
    yield* moveHistory(vault, relative, next).pipe(
      Effect.catch((error) => Effect.logWarning("Could not move page history", { path: relative, error: error._tag })),
    )
  }
  const page = decode(next, source, byFolder)
  const oldKeys = WikiLinks.pageKeys(current.info)
  const newKeys = WikiLinks.pageKeys(page.info)
  const others = (yield* everyPage(vault, after)).filter((item) => item.info.path !== next)
  const otherKeys = new Set(others.flatMap((item) => [...WikiLinks.pageKeys(item.info)]))
  const stale = (key: string) => oldKeys.has(key) && !newKeys.has(key) && !otherKeys.has(key)
  let updatedLinks = 0
  for (const other of others) {
    const rewritten = WikiLinks.rewriteLinks(other.body, stale, title)
    if (rewritten.count === 0) continue
    const target = yield* resolveInside(vault, other.info.path)
    const content = encode(
      { id: other.info.id, title: other.info.title, updatedAt: new Date().toISOString() },
      other.data,
      rewritten.body,
      other.bom,
    )
    const saved = yield* keepVersion(vault, other.info.path, other).pipe(
      Effect.andThen(files.writeIfUnchanged({ target, content, expected: other.bytes })),
      Effect.as(true),
      Effect.catch((error) =>
        Effect.logWarning("Could not update a link to a moved page", { path: other.info.path, error: error._tag }).pipe(
          Effect.as(false),
        ),
      ),
    )
    forgetPage(target.canonical)
    if (saved) updatedLinks += rewritten.count
  }
  return { page: { info: page.info, body: page.body, revision: page.revision }, updatedLinks }
})

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
  if (file.damaged && file.bytes !== undefined) {
    const copy = yield* resolveInside(vault, `${folder}/timeline.json.corrupt-${Date.now()}`)
    yield* files
      .create({ target: copy, content: file.bytes })
      .pipe(Effect.catchTag("FileMutation.TargetExistsError", () => Effect.void))
    yield* Effect.logWarning("Kept a damaged vault timeline aside", { folder })
  }
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
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Skipping unreadable vault log", {
            file: entry.name,
            error: error._tag === "KnowledgeVault.InvalidError" ? error.reason : error._tag,
          }).pipe(Effect.as([])),
        ),
      ),
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

export const conflicts = Effect.fn("KnowledgeVault.conflicts")(function* (vault: Vault) {
  const fs = yield* FSUtil.Service
  const files = yield* fs.glob("**/*", { cwd: vault.directory, absolute: false, include: "file", dot: false })
  return files
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => isConflictCopy(path.posix.basename(file)))
    .sort()
    .map((file) => ({ path: file, original: conflictOriginal(file) }))
})

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
  const folders = [...new Set(notes.flatMap((note) => parents(note.source)))].sort((a, b) => b.length - a.length)
  yield* Effect.forEach(
    folders,
    (folder) => Effect.tryPromise(() => rmdir(path.join(location.directory, ...folder.split("/")))).pipe(Effect.ignore),
    { discard: true },
  )
  yield* Effect.logInfo("Moved notes into the Tenon vault", { count: notes.length })
  return { moved: notes.length, backup }
})

const Machine = Schema.Struct({
  version: Schema.Literal(1),
  machine: Schema.String,
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

export function machineName(host: string) {
  const base =
    host
      .replace(/[^A-Za-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "machine"
  return `${base}-${randomBytes(3).toString("hex")}`
}

const scanFolders = Effect.fnUntraced(function* <A>(
  directory: string,
  name: string,
  decode: (source: string, folder: string) => A | undefined,
) {
  const fs = yield* FSUtil.Service
  const entries = yield* fs.readDirectoryEntries(directory).pipe(Effect.orElseSucceed(() => undefined))
  if (entries === undefined) return { found: [] as A[], unreadable: [path.basename(directory)] }
  const results = yield* Effect.forEach(
    entries.filter((entry) => entry.type === "directory" && !entry.name.startsWith(".")),
    (entry) => {
      const unreadable = `${entry.name}/${name}`
      return readIdFile(path.join(directory, entry.name, name)).pipe(
        Effect.map((source): { value?: A; unreadable?: string } => {
          if (source === undefined) return {}
          const value = decode(source, entry.name)
          return value === undefined ? { unreadable } : { value }
        }),
        Effect.orElseSucceed((): { value?: A; unreadable?: string } => ({ unreadable })),
      )
    },
    { concurrency: 8 },
  )
  return {
    found: results.flatMap((result) => (result.value === undefined ? [] : [result.value])),
    unreadable: results.flatMap((result) => (result.unreadable === undefined ? [] : [result.unreadable])),
  }
})

const unavailable = (file: string) => new InvalidError({ reason: `vault_unavailable: ${file}` })

const workspaceFolders = (root: string) =>
  scanFolders(root, "workspace.json", (source, folder) => {
    const file = Schema.decodeUnknownOption(Schema.fromJsonString(WorkspaceFile))(source)
    return Option.isSome(file) ? { folder, ...file.value } : undefined
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

export function uniqueFolder(base: string, taken: ReadonlyArray<string>) {
  const folded = new Set(taken.map(foldName))
  const name = base.normalize("NFC")
  for (let index = 1; ; index++) {
    const candidate = index === 1 ? name : `${name} (${index})`
    if (!folded.has(foldName(candidate))) return candidate
  }
}

const scanProjects = (vault: Vault) =>
  scanFolders(vault.directory, "project.json", (source, folder) => {
    const file = Schema.decodeUnknownOption(Schema.fromJsonString(ProjectFile))(source)
    return Option.isSome(file) && projectPattern.test(file.value.id) ? ([file.value.id, folder] as const) : undefined
  })

const projectFolders = (vault: Vault) => scanProjects(vault).pipe(Effect.map((scan) => new Map(scan.found)))

const existingProjectFolder = Effect.fnUntraced(function* (vault: Vault, projectId: string) {
  if (!projectPattern.test(projectId)) return yield* new InvalidError({ reason: "invalid_project" })
  const folder = (yield* projectFolders(vault)).get(projectId)
  if (folder === undefined) yield* BrainProject.get(projectId)
  return folder
})

const ensureProjectFolder = Effect.fnUntraced(function* (vault: Vault, projectId: string) {
  const existing = yield* existingProjectFolder(vault, projectId)
  if (existing !== undefined) return existing
  const project = yield* BrainProject.get(projectId)
  return yield* locks.withLock(`workspace:${vault.directory}`)(
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const files = yield* FileMutation.Service
      const scan = yield* scanProjects(vault)
      const again = new Map(scan.found).get(projectId)
      if (again !== undefined) return again
      if (scan.unreadable.length > 0) return yield* unavailable(scan.unreadable[0])
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

function insideFolder(relative: string, folder: string) {
  const [top, ...rest] = relative.split("/")
  return rest.length > 0 && foldName(top) === foldName(folder) ? [folder, ...rest].join("/") : `${folder}/${relative}`
}

export function newPagePath(value: string, projects: ReadonlyMap<string, string>) {
  const folders = value.split("/")
  const name = folders.pop()!.normalize("NFC")
  const normal = [...folders, name].join("/")
  if (!isPagePath(normal) || /[. ]$/.test(name.slice(0, -3))) return undefined
  const folder = [...projects.values()].find((item) => foldName(item) === foldName(folders[0] ?? ""))
  return folder === undefined ? normal : insideFolder(normal, folder)
}

function projectFolderIndex(projects: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const index = new Map<string, string>()
  for (const [id, folder] of projects) {
    const key = foldName(folder)
    if (!index.has(key)) index.set(key, id)
  }
  return index
}

function isListedPage(file: string, byFolder: ReadonlyMap<string, string>) {
  return isPagePath(file) && isWritablePageFolder(file, byFolder) && !isConflictCopy(path.posix.basename(file))
}

function isWritablePageFolder(file: string, byFolder: ReadonlyMap<string, string>) {
  const segments = file.split("/")
  return !(segments.length > 2 && byFolder.has(foldName(segments[0])) && segments[1].toLowerCase() === "log")
}

function isWritablePage(file: string, projects: ReadonlyMap<string, string>) {
  return isWritablePageFolder(file, projectFolderIndex(projects))
}

function projectOfFolder(relative: string, byFolder: ReadonlyMap<string, string>) {
  const slash = relative.indexOf("/")
  if (slash === -1) return null
  return byFolder.get(foldName(relative.slice(0, slash))) ?? null
}

type PageFile = Page & { data: Record<string, unknown>; bom: boolean }

const readPageFile = Effect.fnUntraced(function* (
  vault: Vault,
  relative: string,
  projects: ReadonlyMap<string, string>,
  byFolder: ReadonlyMap<string, string> = projectFolderIndex(projects),
) {
  const target = yield* resolveInside(vault, relative)
  const bytes = yield* readSmall(target.canonical, maxBytes)
  if (bytes === undefined) return yield* new NotFoundError({ path: relative })
  const page = yield* Effect.try({
    try: () => decode(relative, utf8.decode(bytes), byFolder),
    catch: () => new InvalidError({ reason: "invalid_page" }),
  })
  return { ...page, bytes }
})

const pageCache = new Map<string, { relative: string; mtime: number; size: number; info: PageInfo; text?: string }>()
const pageCacheLimit = 5_000
const pageTextLimit = 32 * 1024 * 1024
let pageTextSize = 0

function forgetPage(canonical: string) {
  pageTextSize -= pageCache.get(canonical)?.text?.length ?? 0
  pageCache.delete(canonical)
}

const listedPage = Effect.fnUntraced(function* (
  vault: Vault,
  relative: string,
  byFolder: ReadonlyMap<string, string>,
  search: boolean,
) {
  const fs = yield* FSUtil.Service
  const target = yield* resolveInside(vault, relative)
  const stat = yield* fs
    .stat(target.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  const mtime = stat === undefined ? 0 : Option.match(stat.mtime, { onNone: () => 0, onSome: (date) => date.getTime() })
  const size = Number(stat?.size ?? 0)
  const cached = pageCache.get(target.canonical)
  const entry =
    cached &&
    stat?.type === "File" &&
    mtime > 0 &&
    cached.relative === relative &&
    cached.mtime === mtime &&
    cached.size === size &&
    (!search || cached.text !== undefined)
      ? cached
      : yield* Effect.gen(function* () {
          if (stat === undefined) return yield* new NotFoundError({ path: relative })
          if (stat.type !== "File") return yield* new InvalidError({ reason: "not_a_file" })
          if (size > maxBytes) return yield* new InvalidError({ reason: "too_large" })
          const bytes = yield* fs
            .readFile(target.canonical)
            .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
          if (bytes === undefined) return yield* new NotFoundError({ path: relative })
          const page = yield* Effect.try({
            try: () => decode(relative, utf8.decode(bytes), byFolder),
            catch: () => new InvalidError({ reason: "invalid_page" }),
          })
          return {
            relative,
            mtime,
            size,
            info: page.info,
            text: search ? [page.info.title, page.info.path, page.body].join("\n").toLowerCase() : undefined,
          }
        })
  forgetPage(target.canonical)
  pageCache.set(target.canonical, entry)
  pageTextSize += entry.text?.length ?? 0
  for (const key of pageCache.keys()) {
    if (key === target.canonical || (pageCache.size <= pageCacheLimit && pageTextSize <= pageTextLimit)) break
    forgetPage(key)
  }
  return { info: { ...entry.info, projectId: projectOfFolder(relative, byFolder) }, text: entry.text }
})

function decode(relative: string, raw: string, byFolder: ReadonlyMap<string, string>): PageFile {
  const bom = raw.startsWith("﻿")
  const parsed = Frontmatter.parse(bom ? raw.slice(1) : raw)
  const data = { ...(parsed.data as Record<string, unknown>) }
  const title = typeof data.title === "string" ? data.title.trim() : ""
  return {
    info: {
      id:
        typeof data.id === "string" && /^[\w-]{1,64}$/.test(data.id) ? data.id : `page_${hash(relative).slice(0, 26)}`,
      path: relative,
      title: [...(title || titleFromBody(parsed.content) || path.posix.basename(relative, ".md"))]
        .slice(0, titleLimit)
        .join(""),
      projectId: projectOfFolder(relative, byFolder),
      properties: Object.fromEntries(
        Object.entries(data)
          .filter(([key]) => !reservedKeys.has(key))
          .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
      ),
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
  const source = Frontmatter.stringify(body, { id: head.id, title: head.title, ...rest, updated_at: head.updatedAt })
  return bom ? `﻿${source}` : source
}

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
  yield* versions(vault, relative).pipe(
    Effect.flatMap((all) =>
      Effect.forEach(
        all.slice(historyLimit),
        (version) =>
          resolveInside(vault, `${historyFolder(relative)}/${version}.md`).pipe(
            Effect.flatMap((stale) => files.remove({ target: stale })),
          ),
        { discard: true },
      ),
    ),
    Effect.catch((error) => Effect.logWarning("Could not prune page history", { path: relative, error: error._tag })),
  )
})

const TimelineFile = Schema.Struct({ version: Schema.Literal(1), items: Schema.Array(TimelineItem) })

const timelineFile = Effect.fnUntraced(function* (vault: Vault, folder: string) {
  const target = yield* resolveInside(vault, `${folder}/timeline.json`)
  const bytes = yield* readSmall(target.canonical, maxBytes)
  if (bytes === undefined) return { target, bytes, damaged: false, revision: "new", items: [] as TimelineItem[] }
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(TimelineFile))(utf8.decode(bytes))
  if (Option.isNone(decoded)) yield* Effect.logWarning("Unreadable vault timeline", { folder })
  return {
    target,
    bytes,
    damaged: Option.isNone(decoded),
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

const resolveInside = (vault: Vault, relative: string) => resolveUnder(vault.directory, relative)

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

const entryKind = (file: string) =>
  Effect.tryPromise(() => lstat(file)).pipe(
    Effect.map((stat) =>
      stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
    ),
    Effect.orElseSucceed(() => "missing" as const),
  )

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

const readIdFile = (file: string) =>
  readSmall(file, smallFileLimit).pipe(Effect.map((bytes) => (bytes === undefined ? undefined : utf8.decode(bytes))))

function hash(source: string) {
  return createHash("sha256").update(source).digest("hex")
}

export function titleFromBody(body: string) {
  const heading = /^ {0,3}#[ \t]+(.*)$/m.exec(body)?.[1]
  if (!heading) return ""
  const text = heading.slice(0, 1000).trimEnd()
  let end = text.length
  while (end > 0 && text[end - 1] === "#") end--
  const closed = end === 0 || text[end - 1] === " " || text[end - 1] === "\t"
  return (closed ? text.slice(0, end) : text).trim()
}
