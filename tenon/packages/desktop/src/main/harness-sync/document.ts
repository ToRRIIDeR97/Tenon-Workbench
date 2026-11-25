import { readdir } from "node:fs/promises"
import path from "node:path"
import type {
  HarnessSyncMode,
  HarnessSyncPresets,
  HarnessSyncToolID,
  HarnessSyncToolPreset,
} from "@tenon/app/harness-sync/types"
import { MAX_SYNC_FILE_BYTES, hash, readText, writeAtomic, nowRfc3339 } from "./fsutil"
import { type Skill, validateSkill, validSkillName } from "./skill-files"
import { findTool } from "./tools"

export const VERSION = 5
const OLDEST_VERSION = 3
const MODES: ReadonlyArray<HarnessSyncMode> = ["shared", "append", "custom", "off"]

export type SyncDocument = {
  version: number
  revision: number
  updatedAt: string
  updatedBy: string
  shared: string
  tools: Partial<Record<HarnessSyncToolID, HarnessSyncToolPreset>>
  sharedSkills: string[]
  skills: Record<string, Skill>
}

const DEFAULT_PRESET: HarnessSyncToolPreset = { mode: "shared", text: "" }

export const preset = (document: SyncDocument, id: HarnessSyncToolID) => document.tools[id] ?? DEFAULT_PRESET

export function render(document: SyncDocument, id: HarnessSyncToolID) {
  const tool = preset(document, id)
  if (tool.mode === "off") return undefined
  const text =
    tool.mode === "shared"
      ? document.shared
      : tool.mode === "custom"
        ? tool.text
        : !tool.text.trim()
          ? document.shared
          : !document.shared.trim()
            ? tool.text
            : `${document.shared.trimEnd()}\n\n${tool.text.trimStart()}`
  return text === "" || text.endsWith("\n") ? text : `${text}\n`
}

export function skillSet(document: SyncDocument, id: HarnessSyncToolID) {
  const tool = document.tools[id]
  const extras = tool?.skillExtras ?? []
  const mode = tool?.skillMode ?? "shared"
  if (mode === "off") return undefined
  const names =
    mode === "shared" ? document.sharedSkills : mode === "append" ? [...document.sharedSkills, ...extras] : extras
  return new Map(
    names
      .filter((name) => Object.hasOwn(document.skills, name))
      .toSorted()
      .map((name) => [name, document.skills[name]] as const),
  )
}

const referencedSkills = (document: Pick<SyncDocument, "sharedSkills" | "tools">) =>
  new Set([...document.sharedSkills, ...Object.values(document.tools).flatMap((tool) => tool?.skillExtras ?? [])])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stringList = (value: unknown, what: string) => {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${what} is malformed`)
  return value
}

function toolPreset(value: unknown, id: string): HarnessSyncToolPreset {
  if (!isRecord(value)) throw new Error(`The preset for ${id} is malformed`)
  const mode = value.mode
  const skillMode = value.skillMode ?? "shared"
  if (!MODES.includes(mode as HarnessSyncMode) || !MODES.includes(skillMode as HarnessSyncMode))
    throw new Error(`The preset for ${id} has an unknown mode`)
  if (value.text !== undefined && typeof value.text !== "string") throw new Error(`The preset for ${id} is malformed`)
  const extras = stringList(value.skillExtras, `The skill list for ${id}`)
  return {
    mode: mode as HarnessSyncMode,
    text: value.text ?? "",
    ...(skillMode === "shared" ? {} : { skillMode: skillMode as HarnessSyncMode }),
    ...(extras.length ? { skillExtras: extras } : {}),
  }
}

function toolPresets(tools: unknown, tenon: unknown) {
  if (tools !== undefined && !isRecord(tools)) throw new Error("The tool presets are malformed")
  const entries = Object.entries(tools ?? {}).map(([id, value]) => {
    if (!findTool(id)) throw new Error(`Unknown tool "${id}" in the sync file`)
    return [id, toolPreset(value, id)] as const
  })
  const own = tenon === undefined ? [] : [["tenon", toolPreset(tenon, "tenon")] as const]
  return Object.fromEntries([...entries, ...own]) as SyncDocument["tools"]
}

function validatePresets(shared: string, tools: SyncDocument["tools"]) {
  if (shared.includes("\0") || Object.values(tools).some((tool) => tool?.text.includes("\0")))
    throw new Error("Presets cannot contain NUL characters")
}

function validateSkills(document: SyncDocument) {
  Object.entries(document.skills).forEach(([name, skill]) => validateSkill(name, skill))
  const bad = [...referencedSkills(document)].find((name) => !validSkillName(name))
  if (bad !== undefined) throw new Error(`"${bad}" is not a valid skill name`)
}

function skillLibrary(value: unknown): Record<string, Skill> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error("The skills are malformed")
  return Object.fromEntries(
    Object.entries(value).map(([name, skill]) => {
      if (!isRecord(skill) || !isRecord(skill.files) || !Object.values(skill.files).every((t) => typeof t === "string"))
        throw new Error(`Skill "${name}" is malformed`)
      return [name, { files: skill.files as Record<string, string> }]
    }),
  )
}

function migrateV4(value: Record<string, unknown>): Record<string, unknown> {
  const tools = isRecord(value.tools) ? value.tools : {}
  return {
    ...value,
    sharedSkills: Object.keys(isRecord(value.skills) ? value.skills : {}),
    tools: Object.fromEntries(
      Object.entries(tools).map(([id, tool]) => {
        if (!isRecord(tool)) return [id, tool]
        const { skills, ...rest } = tool
        return [id, skills === false ? { ...rest, skillMode: "off" } : rest]
      }),
    ),
  }
}

export function parse(content: string): SyncDocument {
  const raw = (() => {
    try {
      return JSON.parse(content) as unknown
    } catch (error) {
      throw new Error(`The sync file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      })
    }
  })()
  const version = isRecord(raw) ? raw.version : undefined
  if (!isRecord(raw) || typeof version !== "number" || !Number.isInteger(version) || version < OLDEST_VERSION)
    throw new Error("This is not a Harness Sync file")
  if (version > VERSION) throw new Error("The sync file was written by a newer version of Harness Sync. Update Tenon.")
  const value = version === 4 ? migrateV4(raw) : raw
  if (
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.updatedAt !== "string" ||
    typeof value.updatedBy !== "string" ||
    typeof value.shared !== "string"
  )
    throw new Error("The sync file is malformed")
  const document: SyncDocument = {
    version: VERSION,
    revision: value.revision,
    updatedAt: value.updatedAt,
    updatedBy: value.updatedBy,
    shared: value.shared,
    tools: toolPresets(value.tools, value.tenon),
    sharedSkills: stringList(value.sharedSkills, "The shared skill list"),
    skills: skillLibrary(value.skills),
  }
  validatePresets(document.shared, document.tools)
  validateSkills(document)
  return document
}

const sortedRecord = <T>(record: Record<string, T>) =>
  Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

export function serialize(document: SyncDocument) {
  const { tenon, ...tools } = document.tools
  const out = {
    version: VERSION,
    revision: document.revision,
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
    shared: document.shared,
    tools: sortedRecord(tools),
    sharedSkills: document.sharedSkills,
    skills: sortedRecord(
      Object.fromEntries(
        Object.entries(document.skills).map(([name, skill]) => [name, { files: sortedRecord(skill.files) }]),
      ),
    ),
    ...(tenon ? { tenon } : {}),
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

async function read(file: string) {
  const text = await readText(file, MAX_SYNC_FILE_BYTES).catch((error: unknown) => {
    throw new Error(`The sync file ${error instanceof Error ? error.message : String(error)}`)
  })
  if (text === undefined) throw new Error("The sync file was not found. Check that Google Drive is running.")
  return text
}

export async function load(file: string) {
  const content = await read(file)
  return { document: parse(content), hash: hash(content) }
}

export const readHash = (file: string) => read(file).then(hash)

async function write(file: string, document: SyncDocument) {
  const content = serialize(document)
  if (Buffer.byteLength(content) > MAX_SYNC_FILE_BYTES)
    throw new Error("Presets and skills are too large; the sync file is limited to 8 MB")
  await writeAtomic(file, content)
}

export async function create(file: string, shared: string, device: string) {
  const existing = await readText(file).catch(() => undefined)
  if (existing !== undefined && isSyncFile(existing))
    throw new Error("That file is already a sync file. Open it instead.")
  const document: SyncDocument = {
    version: VERSION,
    revision: 1,
    updatedAt: nowRfc3339(),
    updatedBy: device,
    shared,
    tools: {},
    sharedSkills: [],
    skills: {},
  }
  validatePresets(document.shared, document.tools)
  await write(file, document)
  return document
}

const isSyncFile = (content: string) => {
  try {
    parse(content)
    return true
  } catch {
    return false
  }
}

const unique = (names: string[]) => [...new Set(names)]
const isDefault = (tool: HarnessSyncToolPreset) =>
  tool.mode === "shared" && tool.text === "" && (tool.skillMode ?? "shared") === "shared" && !tool.skillExtras?.length

export async function save(
  file: string,
  expectedRevision: number,
  presets: Pick<HarnessSyncPresets, "shared" | "tools" | "sharedSkills">,
  uploads: Record<string, Skill>,
  device: string,
) {
  validatePresets(presets.shared, presets.tools)
  const current = (await load(file)).document
  if (current.revision !== expectedRevision)
    throw new Error(
      `${current.updatedBy} changed the presets while you were editing. Your edits were not saved; reload to see their version.`,
    )
  const tools = Object.fromEntries(
    Object.entries(presets.tools)
      .filter((entry): entry is [string, HarnessSyncToolPreset] => entry[1] !== undefined)
      .map(([id, tool]) => {
        const extras = unique(tool.skillExtras ?? [])
        const clean: HarnessSyncToolPreset = {
          mode: tool.mode,
          text: tool.text,
          ...((tool.skillMode ?? "shared") === "shared" ? {} : { skillMode: tool.skillMode }),
          ...(extras.length ? { skillExtras: extras } : {}),
        }
        return [id, clean] as const
      })
      .filter(([, tool]) => !isDefault(tool)),
  ) as SyncDocument["tools"]
  const next = { sharedSkills: unique(presets.sharedSkills), tools }
  const referenced = referencedSkills(next)
  const library = { ...current.skills, ...uploads }
  const missing = [...referenced].toSorted().find((name) => !Object.hasOwn(library, name))
  if (missing !== undefined)
    throw new Error(`The ${missing} skill is not in the sync file. Add it from a harness on this computer.`)
  const document: SyncDocument = {
    ...current,
    shared: presets.shared,
    ...next,
    skills: Object.fromEntries(Object.entries(library).filter(([name]) => referenced.has(name))),
    revision: current.revision + 1,
    updatedAt: nowRfc3339(),
    updatedBy: device,
  }
  validateSkills(document)
  await write(file, document)
  return document
}

export async function conflictCopies(file: string) {
  const name = path.basename(file)
  const stem = path.basename(file, path.extname(file))
  const entries = await readdir(path.dirname(file)).catch(() => [] as string[])
  return entries
    .filter(
      (other) =>
        other !== name &&
        other.startsWith(stem) &&
        other.toLowerCase().endsWith(".json") &&
        (other.includes("(") || other.toLowerCase().includes("conflict")),
    )
    .toSorted()
}

export function parsePresets(value: unknown): HarnessSyncPresets {
  if (!isRecord(value) || typeof value.shared !== "string") throw new Error("The presets are malformed")
  const tools = toolPresets(
    isRecord(value.tools)
      ? Object.fromEntries(Object.entries(value.tools).filter(([id]) => id !== "tenon"))
      : value.tools,
    isRecord(value.tools) ? value.tools.tenon : undefined,
  )
  const sources = value.skillSources ?? {}
  if (!isRecord(sources) || !Object.values(sources).every((tool) => findTool(tool)))
    throw new Error("The skill sources are malformed")
  return {
    shared: value.shared,
    tools,
    sharedSkills: stringList(value.sharedSkills, "The shared skill list"),
    skillSources: sources as HarnessSyncPresets["skillSources"],
  }
}
