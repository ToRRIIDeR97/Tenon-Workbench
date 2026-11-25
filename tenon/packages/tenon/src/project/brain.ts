export * as BrainProject from "./brain"

import { Database } from "@tenon/core/database/database"
import { FileMutation } from "@tenon/core/file-mutation"
import { FSUtil } from "@tenon/core/fs-util"
import { Frontmatter } from "@tenon/core/frontmatter"
import { Global } from "@tenon/core/global"
import { Location } from "@tenon/core/location"
import { LocationMutation } from "@tenon/core/location-mutation"
import { SessionTable } from "@tenon/core/session/sql"
import { WorkspaceInstructions } from "@tenon/core/workspace-instructions"
import { and, count, inArray, isNull, max } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import path from "node:path"
import { ulid } from "ulid"
import type { PlannerCalendar } from "../planner/calendar"

const directory = ".tenon/projects"
const legacyDirectory = "projects"
const limit = 1_000
const cardLimit = 1024 * 1024
const idPattern = /^project_[0-9A-Z]+$/i
const utf8 = new TextDecoder()

export const Status = Schema.Literals(["active", "paused", "archived"])
export type Status = typeof Status.Type

export const ProjectLocation = Schema.Struct({
  workspaceId: Schema.optional(Schema.String),
  displayPath: Schema.String,
  path: Schema.optional(Schema.String),
})
export type ProjectLocation = typeof ProjectLocation.Type

export const Info = Schema.Struct({
  id: Schema.String,
  folder: Schema.String,
  name: Schema.String,
  outcome: Schema.String,
  templateId: Schema.optional(Schema.NullOr(Schema.String)),
  instructions: Schema.String,
  status: Status,
  progressPercent: Schema.Number,
  nextMilestone: Schema.optional(Schema.NullOr(Schema.String)),
  blocker: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.Array(Schema.String),
  location: Schema.optional(Schema.NullOr(ProjectLocation)),
  cover: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type Info = typeof Info.Type

export const CoverInput = Schema.Struct({ dataUrl: Schema.String })
export type CoverInput = typeof CoverInput.Type
export const Cover = Schema.Struct({ dataUrl: Schema.NullOr(Schema.String) })
export type Cover = typeof Cover.Type

const coverLimit = 6 * 1024 * 1024
const coverTypes = {
  png: { mime: "image/png", magic: (bytes: Uint8Array) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) },
  jpg: { mime: "image/jpeg", magic: (bytes: Uint8Array) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  gif: { mime: "image/gif", magic: (bytes: Uint8Array) => startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) },
  webp: {
    mime: "image/webp",
    magic: (bytes: Uint8Array) =>
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
} as const
type CoverExtension = keyof typeof coverTypes
const coverName = /^cover\.(png|jpg|gif|webp)$/

export const CreateInput = Schema.Struct({
  name: Schema.String,
  outcome: Schema.String,
  templateId: Schema.optional(Schema.NullOr(Schema.String)),
  instructions: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  location: Schema.optional(Schema.NullOr(ProjectLocation)),
})
export type CreateInput = typeof CreateInput.Type

export const UpdateInput = Schema.Struct({
  expectedUpdatedAt: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.String),
  templateId: Schema.optional(Schema.NullOr(Schema.String)),
  instructions: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  progressPercent: Schema.optional(Schema.Number),
  nextMilestone: Schema.optional(Schema.NullOr(Schema.String)),
  blocker: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
  location: Schema.optional(Schema.NullOr(ProjectLocation)),
})
export type UpdateInput = typeof UpdateInput.Type

export const Workspace = Schema.Struct({
  id: Schema.String,
  worktree: Schema.String,
  name: Schema.optional(Schema.String),
})
export type Workspace = typeof Workspace.Type

export const ThreadDirectoryKind = Schema.Literals(["workspace", "folder", "project"])
export type ThreadDirectoryKind = typeof ThreadDirectoryKind.Type

export const ThreadSummary = Schema.Struct({
  project: Info,
  threadDirectory: Schema.String,
  threadDirectoryKind: ThreadDirectoryKind,
  workspace: Schema.NullOr(Workspace),
  rootSessionCount: Schema.Number,
  lastActivityAt: Schema.NullOr(Schema.Number),
})
export type ThreadSummary = typeof ThreadSummary.Type

export const EnsureWorkspaceInput = Schema.Struct({
  workspaceId: Schema.String,
})
export type EnsureWorkspaceInput = typeof EnsureWorkspaceInput.Type

export class InvalidError extends Schema.TaggedError<InvalidError>()("BrainProject.InvalidError", {
  reason: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("BrainProject.NotFoundError", {
  id: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()("BrainProject.ConflictError", {
  reason: Schema.String,
}) {}

type Card = { info: Info; data: Record<string, unknown>; body: string }

export const list = Effect.fn("BrainProject.list")(function* () {
  return (yield* all()).slice(0, limit)
})

const all = Effect.fn("BrainProject.all")(function* () {
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const paths = yield* fs.glob(
    `{${directory}/project_*/project.md,${legacyDirectory}/project_*.md,${legacyDirectory}/project_*/project.md}`,
    {
      cwd: location.directory,
      absolute: false,
      include: "file",
      dot: true,
    },
  )
  const cards = yield* Effect.forEach(
    paths.map((path) => path.replaceAll("\\", "/")),
    (path) =>
      listedCard(path).pipe(
        Effect.flatMap((info) =>
          info.id === pathId(path)
            ? Effect.succeed({ path, info })
            : Effect.logWarning("Skipping Project card whose id does not match its path", { path }).pipe(
                Effect.as(undefined),
              ),
        ),
        Effect.catch((error) =>
          Effect.logWarning("Skipping unreadable Project card", { path, error: error._tag }).pipe(Effect.as(undefined)),
        ),
      ),
    { concurrency: 8 },
  )
  const byId = new Map<string, Info>()
  cards
    .filter((card) => card !== undefined)
    .sort((left, right) => cardRank(left.path) - cardRank(right.path))
    .forEach((card) => byId.set(card.info.id, card.info))
  return [...byId.values()].sort(
    (left, right) =>
      statusRank(left.status) - statusRank(right.status) ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.name.localeCompare(right.name),
  )
})

function pathId(path: string) {
  return path.match(/(?:^|\/)(project_[^/]+?)(?:\.md|\/project\.md)$/i)?.[1]
}

function cardRank(path: string) {
  if (path.startsWith(`${directory}/`)) return 2
  return path.endsWith("/project.md") ? 1 : 0
}

export const get = Effect.fn("BrainProject.get")(function* (id: string) {
  return (yield* readProjectCard(id)).info
})

export const create = Effect.fn("BrainProject.create")(function* (input: CreateInput, projects?: ReadonlyArray<Info>) {
  const existing = projects ?? (yield* all())
  const folder = input.location ? undefined : yield* newProjectFolder(input.name.trim(), existing)
  const now = new Date().toISOString()
  const id = `project_${ulid()}`
  const info = yield* Effect.try({
    try: () =>
      validate({
        id,
        folder: managedFolder(id),
        name: input.name.trim(),
        outcome: input.outcome.trim(),
        templateId: optional(input.templateId),
        instructions: input.instructions?.trim() ?? "",
        status: "active",
        progressPercent: 0,
        nextMilestone: undefined,
        blocker: undefined,
        tags: normalizeTags(input.tags ?? []),
        location: folder ? { displayPath: folder, path: folder } : normalizeLocation(input.location),
        createdAt: now,
        updatedAt: now,
      }),
    catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_card" })),
  })
  if (existing.some((project) => project.name.toLowerCase() === info.name.toLowerCase())) {
    return yield* new ConflictError({ reason: "duplicate_name" })
  }
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: managedProjectPath(info.id), kind: "file" })
  yield* files
    .create({ target, content: encode(info, {}, `# ${info.name}\n\n${info.outcome}\n`) })
    .pipe(Effect.catchTag("FileMutation.TargetExistsError", () => Effect.fail(new ConflictError({ reason: "exists" }))))
  yield* Effect.gen(function* () {
    const notesTarget = yield* mutation.resolve({ path: `${info.folder}/notes/.gitkeep`, kind: "file" })
    yield* files.write({ target: notesTarget, content: "" })
    const timelineTarget = yield* mutation.resolve({ path: `${info.folder}/timeline/calendar.json`, kind: "file" })
    yield* files.write({
      target: timelineTarget,
      content: timelineSource({ version: 2, revision: "", events: [], tasks: [] }),
    })
    if (folder) {
      const location = yield* Location.Service
      const fs = yield* FSUtil.Service
      yield* fs.ensureDir(path.join(location.directory, folder))
    }
  }).pipe(
    Effect.onError(() =>
      Effect.gen(function* () {
        const card = yield* mutation.resolve({ path: managedProjectPath(info.id), kind: "file" })
        yield* files.remove({ target: card })
        const notes = yield* mutation.resolve({ path: `${info.folder}/notes/.gitkeep`, kind: "file" })
        yield* files.remove({ target: notes })
        const timeline = yield* mutation.resolve({ path: `${info.folder}/timeline/calendar.json`, kind: "file" })
        yield* files.remove({ target: timeline })
      }).pipe(Effect.ignore),
    ),
  )
  return info
})

export const update = Effect.fn("BrainProject.update")(function* (
  id: string,
  input: UpdateInput & { readonly cover?: string | null },
) {
  const card = yield* readProjectCard(id)
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== card.info.updatedAt) {
    return yield* new ConflictError({ reason: "stale" })
  }
  const info = yield* Effect.try({
    try: () =>
      validate({
        ...card.info,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome.trim() } : {}),
        ...(input.templateId !== undefined ? { templateId: optional(input.templateId) } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions.trim() } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.progressPercent !== undefined ? { progressPercent: input.progressPercent } : {}),
        ...(input.nextMilestone !== undefined ? { nextMilestone: optional(input.nextMilestone) } : {}),
        ...(input.blocker !== undefined ? { blocker: optional(input.blocker) } : {}),
        ...(input.tags !== undefined ? { tags: normalizeTags(input.tags) } : {}),
        ...(input.location !== undefined ? { location: normalizeLocation(input.location) } : {}),
        ...(input.cover !== undefined ? { cover: optional(input.cover) } : {}),
        updatedAt: new Date().toISOString(),
      }),
    catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_card" })),
  })
  if (
    input.name !== undefined &&
    (yield* all()).some(
      (project) => project.id !== id && project.name.trim().toLowerCase() === info.name.trim().toLowerCase(),
    )
  ) {
    return yield* new ConflictError({ reason: "duplicate_name" })
  }
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: card.path, kind: "file" })
  yield* files
    .writeIfUnchanged({
      target,
      content: encode(info, card.data, card.body),
      expected: card.bytes,
    })
    .pipe(
      Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(new ConflictError({ reason: "stale" }))),
      Effect.ensuring(Effect.sync(() => cardCache.delete(target.canonical))),
    )
  return info
})

export const readCover = Effect.fn("BrainProject.readCover")(function* (id: string) {
  const info = yield* get(id)
  const name = info.cover
  if (!name) return { dataUrl: null } satisfies Cover
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const target = yield* mutation.resolve({ path: `${info.folder}/${name}`, kind: "file" })
  const bytes = yield* fs
    .readFile(target.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  const type = coverTypes[name.slice("cover.".length) as CoverExtension]
  if (!bytes || bytes.length > coverLimit || !type?.magic(bytes)) return { dataUrl: null } satisfies Cover
  return { dataUrl: `data:${type.mime};base64,${Buffer.from(bytes).toString("base64")}` } satisfies Cover
})

export const writeCover = Effect.fn("BrainProject.writeCover")(function* (id: string, input: CoverInput) {
  const image = yield* Effect.try({
    try: () => parseCover(input.dataUrl),
    catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_cover" })),
  })
  const info = yield* get(id)
  const name = `cover.${image.extension}`
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: `${info.folder}/${name}`, kind: "file" })
  yield* files.write({ target, content: image.bytes })
  if (info.cover && info.cover !== name) yield* removeCoverFile(info.folder, info.cover)
  return yield* update(id, { cover: name })
})

export const removeCover = Effect.fn("BrainProject.removeCover")(function* (id: string) {
  const info = yield* get(id)
  if (!info.cover) return info
  const next = yield* update(id, { cover: null })
  yield* removeCoverFile(info.folder, info.cover)
  return next
})

const removeCoverFile = Effect.fnUntraced(function* (folder: string, name: string) {
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: `${folder}/${name}`, kind: "file" })
  yield* files.remove({ target }).pipe(Effect.ignore)
})

export function parseCover(dataUrl: string) {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) throw new InvalidError({ reason: "invalid_cover" })
  const extension: CoverExtension = match[1] === "jpeg" ? "jpg" : (match[1] as CoverExtension)
  const encoded = match[2]!
  if (encoded.length > Math.ceil((coverLimit * 4) / 3) + 4) throw new InvalidError({ reason: "cover_too_large" })
  const bytes = new Uint8Array(Buffer.from(encoded, "base64"))
  if (bytes.length === 0 || bytes.length > coverLimit) throw new InvalidError({ reason: "cover_too_large" })
  if (!coverTypes[extension].magic(bytes)) throw new InvalidError({ reason: "invalid_cover" })
  return { extension, bytes }
}

function startsWith(bytes: Uint8Array, prefix: ReadonlyArray<number>) {
  return prefix.every((value, index) => bytes[index] === value)
}

export const ensureForWorkspace = Effect.fn("BrainProject.ensureForWorkspace")(function* (
  workspace: Workspace,
  loaded?: ReadonlyArray<Info>,
) {
  const projects = loaded ?? (yield* all())
  const existing = projects.find((project) => project.location?.workspaceId === workspace.id)
  if (existing) return { project: existing, created: false }
  const base = workspaceName(workspace)
  const project = yield* create(
    {
      name: uniqueName(base, new Set(projects.map((project) => project.name.trim().toLowerCase()))),
      outcome: `Threads and work in ${base}.`,
      location: { workspaceId: workspace.id, displayPath: workspace.worktree },
    },
    projects,
  )
  return { project, created: true }
})

export const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  linkedFolders: Schema.Array(Schema.String),
})
export type Manifest = typeof Manifest.Type

export const ScanResult = Schema.Struct({
  folders: Schema.Number,
  created: Schema.Number,
  missing: Schema.Array(Schema.String),
})
export type ScanResult = typeof ScanResult.Type

export const LinkInput = Schema.Struct({ folder: Schema.String })
export type LinkInput = typeof LinkInput.Type

export const scan = Effect.fn("BrainProject.scan")(function* () {
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const root = location.directory
  const manifest = yield* readManifest()
  if (!manifest.exists) yield* writeManifest(manifest.value)
  const local = yield* projectFolders(root)
  const present = yield* Effect.forEach(manifest.value.linkedFolders, (folder) => fs.isDir(folder))
  const allowed = yield* Effect.forEach(manifest.value.linkedFolders, (folder) =>
    linkableFolder(root, folder).pipe(Effect.map((reason) => reason === undefined)),
  )
  const refused = manifest.value.linkedFolders.filter((_, index) => present[index] && !allowed[index])
  if (refused.length > 0)
    yield* Effect.logWarning("Ignoring linked folders the manifest may not claim", { count: refused.length })
  const linked = manifest.value.linkedFolders.filter((_, index) => present[index] && allowed[index])
  const projects = [...(yield* all())]
  const known = new Set(
    projects.flatMap((project) => (project.location?.path ? [path.resolve(root, project.location.path)] : [])),
  )
  const created = yield* Effect.forEach([...local, ...linked], (folder) =>
    Effect.gen(function* () {
      if (known.has(path.resolve(root, folder))) return false
      const name = uniqueName(
        [...path.basename(folder)].slice(0, 180).join(""),
        new Set(projects.map((project) => project.name.trim().toLowerCase())),
      )
      const project = yield* create(
        { name, outcome: `Work in ${name}.`, location: { displayPath: folder, path: folder } },
        projects,
      )
      projects.push(project)
      known.add(path.resolve(root, folder))
      return true
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Skipping project folder", { folder, error: error._tag }).pipe(Effect.as(false)),
      ),
    ),
  )
  yield* writeLinkIndex(global.data, root, linked)
  return {
    folders: local.length + linked.length,
    created: created.filter(Boolean).length,
    missing: manifest.value.linkedFolders.filter((_, index) => !present[index]),
  }
})

export const link = Effect.fn("BrainProject.link")(function* (input: LinkInput) {
  const location = yield* Location.Service
  const folder = path.resolve(input.folder)
  const reason = yield* linkableFolder(location.directory, input.folder)
  if (reason) return yield* new InvalidError({ reason })
  const manifest = yield* readManifest()
  if (!manifest.value.linkedFolders.some((item) => path.resolve(item) === folder))
    yield* writeManifest({ ...manifest.value, linkedFolders: [...manifest.value.linkedFolders, folder] })
  const result = yield* scan()
  const archived = (yield* all()).find(
    (item) => item.location?.path && path.resolve(item.location.path) === folder && item.status === "archived",
  )
  if (archived) yield* update(archived.id, { status: "active" })
  return result
})

export const unlink = Effect.fn("BrainProject.unlink")(function* (input: LinkInput) {
  const folder = path.resolve(input.folder)
  const manifest = yield* readManifest()
  yield* writeManifest({
    ...manifest.value,
    linkedFolders: manifest.value.linkedFolders.filter((item) => path.resolve(item) !== folder),
  })
  const project = (yield* all()).find(
    (item) => item.location?.path && path.resolve(item.location.path) === folder && item.status !== "archived",
  )
  if (project) yield* update(project.id, { status: "archived" })
  return yield* scan()
})

export const Instructions = Schema.Struct({
  path: Schema.String,
  content: Schema.NullOr(Schema.String),
})
export type Instructions = typeof Instructions.Type

export const InstructionsInput = Schema.Struct({ content: Schema.String })
export type InstructionsInput = typeof InstructionsInput.Type

const instructionsFile = "AGENTS.md"
const instructionsLimit = 64 * 1024
const instructionsReadLimit = 256 * 1024

export const readInstructions = Effect.fn("BrainProject.readInstructions")(function* () {
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const file = path.join(location.directory, instructionsFile)
  const real = yield* fs.realPath(file).pipe(
    Effect.map((value): string | undefined => value),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
  )
  if (real === undefined) return { path: file, content: null }
  const root = yield* fs.realPath(location.directory)
  if (!FSUtil.contains(root, real)) return yield* new InvalidError({ reason: "outside_workspace" })
  const stat = yield* fs.stat(real)
  if (Number(stat.size) > instructionsReadLimit) return yield* new InvalidError({ reason: "too_large" })
  const content = yield* fs.readFileStringSafe(real)
  return { path: file, content: content ?? null }
})

export const writeInstructions = Effect.fn("BrainProject.writeInstructions")(function* (input: InstructionsInput) {
  if (Buffer.byteLength(input.content, "utf8") > instructionsLimit)
    return yield* new InvalidError({ reason: "too_large" })
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: instructionsFile, kind: "file" })
  yield* files.write({ target, content: input.content })
  return yield* readInstructions()
})

export const removeInstructions = Effect.fn("BrainProject.removeInstructions")(function* () {
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: instructionsFile, kind: "file" })
  yield* files.remove({ target })
  return yield* readInstructions()
})

const readManifest = Effect.fn("BrainProject.readManifest")(function* () {
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const file = path.join(location.directory, WorkspaceInstructions.manifestPath)
  const unreadable = () => new InvalidError({ reason: "manifest_unreadable" })
  const stat = yield* fs.stat(file).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
    Effect.mapError(unreadable),
  )
  if (stat !== undefined && (stat.type !== "File" || Number(stat.size) > cardLimit)) return yield* unreadable()
  const source =
    stat === undefined
      ? undefined
      : yield* fs.readFileString(file).pipe(
          Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
          Effect.mapError(unreadable),
        )
  if (source === undefined) return { exists: false, value: { version: 1 as const, linkedFolders: [] } }
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest))(source)
  if (Option.isNone(decoded)) return yield* new InvalidError({ reason: "invalid_manifest" })
  return { exists: true, value: decoded.value }
})

const writeManifest = Effect.fn("BrainProject.writeManifest")(function* (manifest: Manifest) {
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: WorkspaceInstructions.manifestPath, kind: "file" })
  yield* files.write({ target, content: JSON.stringify(manifest, null, 2) + "\n" })
})

const projectFolders = Effect.fn("BrainProject.projectFolders")(function* (root: string) {
  const fs = yield* FSUtil.Service
  const entries = yield* fs.readDirectoryEntries(root).pipe(Effect.orElseSucceed(() => []))
  const parents = entries.filter((entry) => entry.type === "directory" && entry.name.toLowerCase() === "projects")
  const list = (folder: string) => fs.readDirectoryEntries(folder).pipe(Effect.orElseSucceed(() => []))
  const isWorktree = (items: ReadonlyArray<FSUtil.DirEntry>) =>
    items.some((item) => item.name === ".git" && item.type === "file")
  const isWorkingCopy = Effect.fnUntraced(function* (folder: string) {
    const items = yield* list(folder)
    if (isWorktree(items)) return true
    const folders = items.filter((item) => item.type === "directory" && !item.name.startsWith("."))
    if (folders.length === 0) return false
    const nested = yield* Effect.forEach(folders, (item) =>
      list(path.join(folder, item.name)).pipe(Effect.map(isWorktree)),
    )
    return nested.every(Boolean)
  })
  const children = yield* Effect.forEach(parents, (parent) =>
    Effect.gen(function* () {
      const items = (yield* list(path.join(root, parent.name))).filter(
        (item) => item.type === "directory" && !item.name.startsWith(".") && !idPattern.test(item.name),
      )
      const copies = yield* Effect.forEach(items, (item) => isWorkingCopy(path.join(root, parent.name, item.name)))
      return items.filter((_, index) => !copies[index]).map((item) => `${parent.name}/${item.name}`)
    }),
  )
  return children.flat().sort((a, b) => a.localeCompare(b))
})

const newProjectFolder = Effect.fn("BrainProject.newProjectFolder")(function* (
  name: string,
  projects: ReadonlyArray<Info>,
) {
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const entries = yield* fs.readDirectoryEntries(location.directory).pipe(Effect.orElseSucceed(() => []))
  const parent =
    entries.find((entry) => entry.type === "directory" && entry.name.toLowerCase() === "projects")?.name ?? "projects"
  const claimed = new Set(
    projects.flatMap((project) =>
      project.location?.path ? [path.resolve(location.directory, project.location.path).toLowerCase()] : [],
    ),
  )
  const base = folderName(name)
  for (let index = 1; ; index++) {
    const folder = `${parent}/${index === 1 ? base : `${base} (${index})`}`
    if (!claimed.has(path.resolve(location.directory, folder).toLowerCase())) return folder
  }
})

export function folderName(name: string) {
  const cleaned = [...name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")]
    .slice(0, 120)
    .join("")
    .trim()
    .replace(/[. ]+$/, "")
  if (!cleaned) return "Project"
  if (cleaned.startsWith(".") || idPattern.test(cleaned) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(cleaned))
    return `Project ${cleaned}`
  return cleaned
}

const writeLinkIndex = Effect.fn("BrainProject.writeLinkIndex")(function* (
  dataDir: string,
  root: string,
  linked: ReadonlyArray<string>,
) {
  const fs = yield* FSUtil.Service
  const file = path.join(dataDir, WorkspaceInstructions.linkIndexFile)
  const current = yield* fs.readJson(file).pipe(Effect.orElseSucceed(() => ({})))
  const workspace = path.resolve(root)
  const kept = Object.entries(typeof current === "object" && current !== null ? current : {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && path.resolve(entry[1]) !== workspace,
  )
  const owned = new Set(kept.map(([folder]) => path.resolve(folder)))
  const next = Object.fromEntries([
    ...kept,
    ...linked
      .map((folder) => path.resolve(folder))
      .filter((folder) => !owned.has(folder))
      .map((folder) => [folder, workspace] as const),
  ])
  if (JSON.stringify(next) === JSON.stringify(current)) return
  yield* fs
    .writeWithDirs(file, JSON.stringify(next, null, 2) + "\n")
    .pipe(Effect.catch((error) => Effect.logWarning("Could not update the linked-folder index", { error: error._tag })))
})

const linkableFolder = Effect.fnUntraced(function* (root: string, folder: string) {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  if (!path.isAbsolute(folder) || !(yield* fs.isDir(folder))) return "invalid_folder"
  const resolved = path.resolve(folder)
  const workspace = path.resolve(root)
  const resolvedReal = yield* fs.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved))
  const workspaceReal = yield* fs.realPath(workspace).pipe(Effect.orElseSucceed(() => workspace))
  if (
    isWithin(workspace, resolved) ||
    isWithin(resolved, workspace) ||
    isWithin(workspaceReal, resolvedReal) ||
    isWithin(resolvedReal, workspaceReal)
  )
    return "overlaps_workspace"
  const home = path.resolve(global.home)
  const homeReal = yield* fs.realPath(home).pipe(Effect.orElseSucceed(() => home))
  const data = path.resolve(global.data)
  const dataReal = yield* fs.realPath(data).pipe(Effect.orElseSucceed(() => data))
  if (
    isWithin(resolved, home) ||
    isWithin(resolvedReal, homeReal) ||
    isWithin(resolved, data) ||
    isWithin(data, resolved) ||
    isWithin(resolvedReal, dataReal) ||
    isWithin(dataReal, resolvedReal)
  )
    return "protected_folder"
  return undefined
})

function isWithin(parent: string, child: string) {
  const fold = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value)
  const relative = path.relative(fold(parent), fold(child))
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export const threadDirectory = Effect.fn("BrainProject.threadDirectory")(function* (
  project: Info,
  workspaces: ReadonlyArray<Workspace> = [],
  linked: ReadonlyArray<string> = [],
) {
  const location = yield* Location.Service
  const folder = projectFolder(location.directory, project.location?.path, linked)
  if (folder) return { kind: "project" as const, directory: folder, workspace: undefined }
  const workspace = project.location?.workspaceId
    ? workspaces.find((candidate) => candidate.id === project.location?.workspaceId)
    : undefined
  if (workspace) return { kind: "workspace" as const, directory: workspace.worktree, workspace }
  const fs = yield* FSUtil.Service
  const directory = path.join(location.directory, project.folder)
  if (!(yield* fs.existsSafe(directory))) {
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const target = yield* mutation.resolve({ path: `${project.folder}/notes/.gitkeep`, kind: "file" })
    yield* files.write({ target, content: "" })
  }
  return { kind: "folder" as const, directory, workspace: undefined }
})

function projectFolder(root: string, folder: string | undefined, linked: ReadonlyArray<string>) {
  if (!folder) return undefined
  if (path.isAbsolute(folder))
    return linked.some((item) => path.resolve(item) === path.resolve(folder)) ? path.resolve(folder) : undefined
  const resolved = path.resolve(root, folder)
  return isWithin(path.resolve(root), resolved) && resolved !== path.resolve(root) ? resolved : undefined
}

export const linkedFolders = Effect.fn("BrainProject.linkedFolders")(function* () {
  const location = yield* Location.Service
  const manifest = yield* readManifest().pipe(Effect.option)
  if (Option.isNone(manifest)) return []
  const allowed = yield* Effect.forEach(manifest.value.value.linkedFolders, (folder) =>
    linkableFolder(location.directory, folder).pipe(Effect.map((reason) => reason === undefined)),
  )
  return manifest.value.value.linkedFolders.filter((_, index) => allowed[index])
})

export const threadStats = Effect.fn("BrainProject.threadStats")(function* (directories: ReadonlyArray<string>) {
  if (directories.length === 0) return new Map<string, { count: number; lastActivityAt: number | null }>()
  const database = yield* Database.Service
  const db = database.db
  const rows = yield* db
    .select({ directory: SessionTable.directory, count: count(), last: max(SessionTable.time_updated) })
    .from(SessionTable)
    .where(
      and(
        inArray(SessionTable.directory, [...new Set(directories)]),
        isNull(SessionTable.parent_id),
        isNull(SessionTable.time_archived),
      ),
    )
    .groupBy(SessionTable.directory)
    .all()
    .pipe(Effect.orDie)
  return new Map(rows.map((row) => [row.directory, { count: row.count, lastActivityAt: row.last ?? null }]))
})

function workspaceName(workspace: Workspace) {
  const name = path.basename(workspace.worktree.replace(/[\\/]+$/, "")) || workspace.id
  return [...name].slice(0, 180).join("")
}

function uniqueName(base: string, taken: ReadonlySet<string>) {
  if (!taken.has(base.toLowerCase())) return base
  for (let index = 2; ; index++) {
    const candidate = `${base} (${index})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

const existingProjectPath = Effect.fn("BrainProject.existingProjectPath")(function* (id: string) {
  if (!idPattern.test(id)) return yield* new InvalidError({ reason: "invalid_id" })
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const candidates = [managedProjectPath(id), `${legacyDirectory}/${id}/project.md`]
  for (const candidate of candidates) {
    if (yield* fs.existsSafe(yield* fs.resolve(`${location.directory}/${candidate}`))) return candidate
  }
  return `${legacyDirectory}/${id}.md`
})

const readProjectCard = Effect.fn("BrainProject.readProjectCard")(function* (id: string) {
  const path = yield* existingProjectPath(id)
  const card = yield* readCard(path)
  if (card.info.id !== pathId(path)) return yield* new NotFoundError({ id })
  return { ...card, path }
})

export function managedFolder(id: string) {
  return `${directory}/${id}`
}

export function managedProjectPath(id: string) {
  return `${managedFolder(id)}/project.md`
}

export function projectTimeline(snapshot: PlannerCalendar.Snapshot, id: string): PlannerCalendar.Snapshot {
  return {
    ...snapshot,
    events: snapshot.events.filter((event) => event.projectId === id),
    tasks: snapshot.tasks.filter((task) => task.projectId === id),
  }
}

export const syncTimelines = Effect.fn("BrainProject.syncTimelines")(function* (
  snapshot: PlannerCalendar.Snapshot,
  previous?: PlannerCalendar.Snapshot,
) {
  const touched =
    previous === undefined
      ? undefined
      : new Set(
          [...previous.events, ...previous.tasks, ...snapshot.events, ...snapshot.tasks].flatMap((item) =>
            item.projectId ? [item.projectId] : [],
          ),
        )
  if (touched !== undefined && touched.size === 0) return
  const projects = (yield* all()).filter((project) => touched === undefined || touched.has(project.id))
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const fs = yield* FSUtil.Service
  yield* Effect.forEach(
    projects,
    (project) =>
      Effect.gen(function* () {
        const target = yield* mutation.resolve({
          path: `${project.folder}/timeline/calendar.json`,
          kind: "file",
        })
        const next = projectTimeline(snapshot, project.id)
        const current = yield* fs.readFileString(target.canonical).pipe(Effect.option)
        if (Option.isSome(current) && sameTimeline(current.value, next)) return
        yield* files.write({ target, content: timelineSource(next) })
      }),
    { concurrency: 8, discard: true },
  )
})

const cardCache = new Map<string, { path: string; mtime: number; size: number; info: Info }>()
const cardCacheLimit = 2_000

const listedCard = Effect.fnUntraced(function* (path: string) {
  const { target, stat } = yield* statCard(path)
  const mtime = Option.match(stat.mtime, { onNone: () => 0, onSome: (date) => date.getTime() })
  const size = Number(stat.size)
  const cached = cardCache.get(target.canonical)
  cardCache.delete(target.canonical)
  if (
    cached &&
    stat.type === "File" &&
    mtime > 0 &&
    cached.path === path &&
    cached.mtime === mtime &&
    cached.size === size
  ) {
    cardCache.set(target.canonical, cached)
    return cached.info
  }
  const card = yield* readStatted(path, target, stat)
  if (mtime > 0) {
    cardCache.set(target.canonical, { path, mtime, size, info: card.info })
    for (const key of cardCache.keys()) {
      if (cardCache.size <= cardCacheLimit) break
      cardCache.delete(key)
    }
  }
  return card.info
})

const statCard = Effect.fnUntraced(function* (path: string) {
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const target = yield* mutation.resolve({ path, kind: "file" })
  const stat = yield* fs
    .stat(target.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (stat === undefined) return yield* new NotFoundError({ id: pathId(path) ?? path })
  return { target, stat }
})

const readCard = Effect.fn("BrainProject.readCard")(function* (path: string) {
  const { target, stat } = yield* statCard(path)
  return yield* readStatted(path, target, stat)
})

const readStatted = Effect.fnUntraced(function* (
  path: string,
  target: { canonical: string },
  stat: { size: number | bigint },
) {
  const fs = yield* FSUtil.Service
  if (Number(stat.size) > cardLimit) return yield* new InvalidError({ reason: "too_large" })
  const bytes = yield* fs
    .readFile(target.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (bytes === undefined) return yield* new NotFoundError({ id: pathId(path) ?? path })
  const card = yield* Effect.try({
    try: () => decode(utf8.decode(bytes), path),
    catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_card" })),
  })
  return { ...card, bytes }
})

export function decode(source: string, path?: string): Card {
  const parsed = Frontmatter.parse(source)
  const data = { ...(parsed.data as Record<string, unknown>) }
  const version = typeof data.version === "number" ? data.version : 1
  if (version > 2) throw new InvalidError({ reason: "unsupported_version" })
  const location =
    version === 1 && typeof data.workspace_id === "string" && typeof data.workspace_path === "string"
      ? { workspaceId: data.workspace_id, displayPath: data.workspace_path }
      : data.location
  const raw = {
    id: data.id,
    folder:
      typeof data.id !== "string"
        ? ""
        : path && !path.startsWith(`${directory}/`)
          ? `${legacyDirectory}/${data.id}`
          : managedFolder(data.id),
    name: data.title,
    outcome: typeof data.outcome === "string" ? data.outcome : firstParagraph(parsed.content),
    templateId: data.template_id,
    instructions: typeof data.instructions === "string" ? data.instructions : "",
    status: data.status,
    progressPercent: typeof data.progress_percent === "number" ? data.progress_percent : 0,
    nextMilestone: data.next_milestone,
    blocker: data.blocker,
    tags: Array.isArray(data.tags) ? data.tags : [],
    location,
    cover: typeof data.cover === "string" && coverName.test(data.cover) ? data.cover : undefined,
    createdAt: dateString(data.created_at ?? data.updated),
    updatedAt: dateString(data.updated_at ?? data.updated),
  }
  const decoded = Schema.decodeUnknownOption(Info)(raw)
  if (Option.isNone(decoded)) throw new InvalidError({ reason: "invalid_card" })
  const info = validate(decoded.value)
  return { info, data, body: parsed.content }
}

export function encode(info: Info, previous: Record<string, unknown>, body: string) {
  const data = { ...previous }
  delete data.workspace_id
  delete data.workspace_path
  delete data.updated
  Object.assign(data, {
    contract: "project_card",
    version: 2,
    id: info.id,
    type: "project",
    title: info.name,
    outcome: info.outcome,
    instructions: info.instructions,
    status: info.status,
    progress_percent: info.progressPercent,
    tags: [...info.tags],
    created_at: info.createdAt,
    updated_at: info.updatedAt,
  })
  setOptional(data, "template_id", info.templateId)
  setOptional(data, "next_milestone", info.nextMilestone)
  setOptional(data, "blocker", info.blocker)
  setOptional(data, "location", info.location)
  setOptional(data, "cover", info.cover)
  return Frontmatter.stringify(body, data)
}

function validate(info: Info) {
  if (!idPattern.test(info.id) || ![managedFolder(info.id), `${legacyDirectory}/${info.id}`].includes(info.folder)) {
    throw new InvalidError({ reason: "invalid_id" })
  }
  if (info.name.length === 0 || [...info.name].length > 200) throw new InvalidError({ reason: "invalid_name" })
  if (info.outcome.length === 0 || [...info.outcome].length > 4_000)
    throw new InvalidError({ reason: "invalid_outcome" })
  if ([...info.instructions].length > 16_000) throw new InvalidError({ reason: "invalid_instructions" })
  if (!Number.isInteger(info.progressPercent) || info.progressPercent < 0 || info.progressPercent > 100)
    throw new InvalidError({ reason: "invalid_progress" })
  if ([info.nextMilestone, info.blocker].some((value) => value && [...value].length > 1_000))
    throw new InvalidError({ reason: "invalid_summary" })
  const tags = info.tags.map((tag) => tag.toLowerCase())
  if (info.tags.some((tag) => !tag || [...tag].length > 80) || new Set(tags).size !== tags.length)
    throw new InvalidError({ reason: "invalid_tags" })
  if (
    info.location &&
    (!info.location.displayPath.trim() || !(info.location.workspaceId?.trim() || info.location.path?.trim()))
  )
    throw new InvalidError({ reason: "invalid_location" })
  if (info.cover && !coverName.test(info.cover)) throw new InvalidError({ reason: "invalid_cover" })
  return info
}

function timelineSource(snapshot: PlannerCalendar.Snapshot) {
  return JSON.stringify(snapshot, null, 2) + "\n"
}

function sameTimeline(source: string, next: PlannerCalendar.Snapshot) {
  const current = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ revision: Schema.String })))(source)
  return Option.isSome(current) && source === timelineSource({ ...next, revision: current.value.revision })
}

function normalizeTags(tags: ReadonlyArray<string>) {
  return tags.map((tag) => tag.trim()).filter(Boolean)
}

function normalizeLocation(location: ProjectLocation | null | undefined) {
  if (!location) return undefined
  return {
    ...(location.workspaceId?.trim() ? { workspaceId: location.workspaceId.trim() } : {}),
    displayPath: location.displayPath.trim(),
    ...(location.path?.trim() ? { path: location.path.trim() } : {}),
  }
}

function optional(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function setOptional(data: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined || value === null) {
    delete data[key]
    return
  }
  data[key] = value
}

function firstParagraph(body: string) {
  const lines = body.split(/\r?\n/).map((line) => line.trim())
  const start = lines.findIndex((line) => line && !line.startsWith("#"))
  if (start < 0) return ""
  const paragraph = lines.slice(start)
  const end = paragraph.findIndex((line) => !line || line.startsWith("#"))
  return paragraph.slice(0, end < 0 ? undefined : end).join(" ")
}

function dateString(value: unknown) {
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  return ""
}

function statusRank(status: Status) {
  if (status === "active") return 0
  if (status === "paused") return 1
  return 2
}
