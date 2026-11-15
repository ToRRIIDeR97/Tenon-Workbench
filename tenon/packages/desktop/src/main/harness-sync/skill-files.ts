import { lstat, mkdir, readdir, rm, rmdir, unlink } from "node:fs/promises"
import path from "node:path"
import { MAX_FILE_BYTES, hash, readText, writeAtomic } from "./fsutil"

// One skill folder as the sync file stores it: `/`-separated relative paths mapped to their UTF-8 text. Hidden
// entries, `__pycache__` folders and `.pyc` files are ignored. Names and paths are checked so nothing read from a
// sync file can write outside the skill folder.

export type Skill = { files: Record<string, string> }

const MAX_FILES = 200
export const ENTRY_FILE = "SKILL.md"
/** Backups kept for each skill copy. */
const KEPT_BACKUPS = 5

/** Folder names a skill may use: letters, digits, `-`, `_` and `.`, not starting with `.`. */
export const validSkillName = (name: string) =>
  name.length >= 1 && name.length <= 64 && !name.startsWith(".") && /^[A-Za-z0-9._-]+$/.test(name)

const validPath = (relative: string) =>
  relative
    .split("/")
    // eslint-disable-next-line no-control-regex
    .every((part) => part !== "" && !part.startsWith(".") && !/[\\:\u0000-\u001f\u007f]/.test(part))

/** Throws when the skill could write outside its folder or is not a text skill. */
export function validateSkill(name: string, skill: Skill) {
  const files = Object.keys(skill.files)
  if (!validSkillName(name)) throw new Error(`"${name}" is not a valid skill name`)
  if (!Object.hasOwn(skill.files, ENTRY_FILE)) throw new Error(`Skill "${name}" has no ${ENTRY_FILE}`)
  if (files.length > MAX_FILES) throw new Error(`Skill "${name}" has more than ${MAX_FILES} files`)
  const bad = files.find((file) => !validPath(file))
  if (bad !== undefined) throw new Error(`Skill "${name}" has an invalid file path "${bad}"`)
  if (Object.values(skill.files).some((text) => text.includes("\0") || Buffer.byteLength(text) > MAX_FILE_BYTES))
    throw new Error(`Skill "${name}" has a file that is not text or is larger than 1 MB`)
}

export const isValidSkill = (name: string, skill: Skill) => {
  try {
    validateSkill(name, skill)
    return true
  } catch {
    return false
  }
}

const sortedFiles = (skill: Skill) =>
  Object.fromEntries(Object.entries(skill.files).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/** A content hash that does not depend on the order files were read in. */
export const skillHash = (skill: Skill) => hash(JSON.stringify(sortedFiles(skill)))

export const sameSkill = (a: Skill, b: Skill) => skillHash(a) === skillHash(b)

/** The `description` from SKILL.md front matter. */
export function skillDescription(skill: Skill) {
  const lines = (skill.files[ENTRY_FILE] ?? "").split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return ""
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  const line = lines.slice(1, end === -1 ? undefined : end).find((line) => line.startsWith("description:"))
  if (line === undefined) return ""
  return line
    .slice("description:".length)
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .slice(0, 400)
}

/** Hidden entries and Python bytecode caches, which Python regenerates and are not text. */
const ignored = (name: string) => name.startsWith(".") || name === "__pycache__" || name.endsWith(".pyc")

/** The regular files under `dir` that are not ignored, as `/`-separated relative paths. */
async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => !ignored(entry.name))
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`contains a symbolic link (${relative}), so Tenon leaves it alone`)
      if (entry.isDirectory()) return listFiles(path.join(dir, entry.name), relative)
      return entry.isFile() ? [relative] : []
    }),
  )
  const files = nested.flat()
  if (files.length > MAX_FILES) throw new Error(`has more than ${MAX_FILES} files`)
  return files
}

const join = (dir: string, relative: string) => path.join(dir, ...relative.split("/"))

const kind = (target: string) =>
  lstat(target).then(
    (info) => (info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : "other"),
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "missing" as const
      throw error
    },
  )

/** Reads a skill folder; undefined when it does not exist. Throws a reason to show. */
export async function readSkill(dir: string): Promise<Skill | undefined> {
  const found = await kind(dir)
  if (found === "missing") return undefined
  if (found === "link") throw new Error("is a symbolic link, so Tenon leaves it alone")
  if (found !== "dir") throw new Error("is not a folder")
  const files = await listFiles(dir)
  const texts = await Promise.all(
    files.map((relative) =>
      readText(join(dir, relative)).then(
        (text) => [relative, text ?? ""] as const,
        (error: unknown) => {
          throw new Error(`${relative} ${error instanceof Error ? error.message : String(error)}`)
        },
      ),
    ),
  )
  return { files: Object.fromEntries(texts) }
}

/** Makes `dir` hold exactly the skill's files. Hidden and ignored files are left alone. */
export async function writeSkill(dir: string, skill: Skill) {
  const found = await kind(dir)
  if (found === "link" || found === "other") throw new Error("is not a folder")
  const existing = found === "dir" ? await listFiles(dir) : []
  for (const [relative, text] of Object.entries(skill.files)) await writeAtomic(join(dir, relative), text)
  await Promise.all(existing.filter((file) => !Object.hasOwn(skill.files, file)).map((file) => unlink(join(dir, file))))
  await pruneEmpty(dir)
}

/** Removes the skill's files, then any folders left empty, including the skill folder. */
export async function removeSkill(dir: string, skill: Skill) {
  await Promise.all(Object.keys(skill.files).map((file) => unlink(join(dir, file))))
  await pruneEmpty(dir)
  await rmdir(dir).catch(() => undefined)
}

async function pruneEmpty(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        await pruneEmpty(path.join(dir, entry.name))
        await rmdir(path.join(dir, entry.name)).catch(() => undefined)
      }),
  )
}

/** Skill folder names in a tool's skills folder, skipping hidden entries and invalid names. */
export async function localSkillNames(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && validSkillName(entry.name))
    .map((entry) => entry.name)
    .toSorted()
}

let lastBackup = 0

/** Saves `skill` under `root/<owner>/<name>/<time>` and keeps the newest five. Returns the folder. */
export async function backUpSkill(root: string, owner: string, name: string, skill: Skill) {
  const parent = path.join(root, owner, name)
  // Milliseconds, zero-padded and never repeated, so names sort by age and a pruned name is never used again.
  lastBackup = Math.max(Date.now(), lastBackup + 1)
  const dir = path.join(parent, String(lastBackup).padStart(15, "0"))
  await mkdir(dir, { recursive: true })
  for (const [relative, text] of Object.entries(skill.files)) await writeAtomic(join(dir, relative), text)
  const kept = (await readdir(parent, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((e) => e.name)
  await Promise.all(
    kept
      .toSorted()
      .toReversed()
      .slice(KEPT_BACKUPS)
      .map((old) => rm(path.join(parent, old), { recursive: true, force: true })),
  )
  return dir
}
