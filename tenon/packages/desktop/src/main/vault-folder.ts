import { existsSync } from "node:fs"
import { cp, readdir, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"

const ignorable = new Set([".ds_store", "desktop.ini", "thumbs.db"])

export type VaultMove = { previous?: string } | { error: "not_empty" | "nested" | "copy_failed" }

export async function moveVault(from: string, to: string, api: path.PlatformPath = path): Promise<VaultMove> {
  if (within(to, from, api) && within(from, to, api)) return {}
  if (within(to, from, api) || within(from, to, api)) return { error: "nested" }
  const target = await entries(to)
  if (await isVault(to, target, api)) return {}
  if (target.length > 0) return { error: "not_empty" }
  const source = await entries(from)
  if (!(await isVault(from, source, api))) return {}
  const copied = await Promise.all(
    source.map((name) =>
      cp(api.join(from, name), api.join(to, name), { recursive: true, errorOnExist: true, force: false }),
    ),
  )
    .then(() => sameFiles(from, to, source, api))
    .catch(() => false)
  if (copied) return { previous: from }
  await Promise.all(source.map((name) => rm(api.join(to, name), { recursive: true, force: true }))).catch(() => {})
  return { error: "copy_failed" }
}

export function within(child: string, parent: string, api: path.PlatformPath = path) {
  const fold = (value: string) => (api === path.win32 ? api.resolve(value).toLowerCase() : api.resolve(value))
  const relative = api.relative(fold(parent), fold(child))
  return relative === "" || (!relative.startsWith("..") && !api.isAbsolute(relative))
}

async function entries(folder: string) {
  const names = await readdir(folder).catch(() => [] as string[])
  return names.filter((name) => !ignorable.has(name.toLowerCase()))
}

async function isVault(folder: string, names: ReadonlyArray<string>, api: path.PlatformPath) {
  const found = await Promise.all(
    names
      .filter((name) => !name.startsWith("."))
      .map((name) =>
        stat(api.join(folder, name, "workspace.json")).then(
          (file) => file.isFile(),
          () => false,
        ),
      ),
  )
  return found.includes(true)
}

async function sameFiles(from: string, to: string, copied: ReadonlyArray<string>, api: path.PlatformPath) {
  for (const name of await readdir(from, { recursive: true })) {
    if (!copied.includes(name.split(/[\\/]/)[0])) continue
    const source = api.join(from, name)
    if (!(await stat(source)).isFile()) continue
    const [left, right] = await Promise.all([readFile(source), readFile(api.join(to, name))])
    if (!left.equals(right)) return false
  }
  return true
}

export function vaultFolder(chosen: unknown, documents: string, api: path.PlatformPath = path) {
  if (typeof chosen === "string" && chosen.trim() && api.isAbsolute(chosen.trim())) return api.resolve(chosen.trim())
  return api.join(documents, "Tenon")
}

export function insideCodeFolder(
  folder: string,
  home: string,
  exists: (file: string) => boolean = existsSync,
  api: path.PlatformPath = path,
) {
  const stop = api.resolve(home)
  for (let current = api.resolve(folder); ; current = api.dirname(current)) {
    if (current === stop) return false
    if (exists(api.join(current, ".git")) || exists(api.join(current, ".tenon", "workspace.json"))) return true
    if (api.dirname(current) === current) return false
  }
}
