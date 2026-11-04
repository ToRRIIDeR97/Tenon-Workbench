import { existsSync } from "node:fs"
import { cp, readdir, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"

/** What Explorer and Finder leave in a folder; a folder holding only these counts as empty. */
const ignorable = new Set([".ds_store", "desktop.ini", "thumbs.db"])

export type VaultMove = { previous?: string } | { error: "not_empty" | "nested" | "copy_failed" }

/**
 * Get `to` ready to replace the vault at `from`. An existing vault (a folder with a `workspace.json` one level
 * down) is used as it is; any other non-empty folder is refused. Otherwise the current vault's contents are
 * copied over and compared file by file. The old folder is never changed: `previous` names it so the user can
 * remove it once they have checked the copy. A failed copy removes what it wrote and reports `copy_failed`.
 * Paths compare without letter case on Windows.
 */
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

/** Whether `child` is `parent` or sits inside it. */
export function within(child: string, parent: string, api: path.PlatformPath = path) {
  const fold = (value: string) => (api === path.win32 ? api.resolve(value).toLowerCase() : api.resolve(value))
  const relative = api.relative(fold(parent), fold(child))
  return relative === "" || (!relative.startsWith("..") && !api.isAbsolute(relative))
}

/** A folder's entries, without the ones Explorer and Finder add; none when it is missing. */
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

/**
 * Every file under the `copied` entries of `from` is under `to` with the same bytes. One file at a time, so a
 * large vault never runs out of handles.
 */
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

/**
 * The Tenon vault folder the server gets as `TENON_VAULT_DIR`: the folder the user chose in the app, else
 * `<Documents>/Tenon`. Electron's Documents folder already follows a OneDrive (Windows) or iCloud Desktop &
 * Documents (macOS) redirect, so the default vault may be synced. `api` lets tests check both platforms.
 */
export function vaultFolder(chosen: unknown, documents: string, api: path.PlatformPath = path) {
  if (typeof chosen === "string" && chosen.trim() && api.isAbsolute(chosen.trim())) return api.resolve(chosen.trim())
  return api.join(documents, "Tenon")
}

/**
 * Whether `folder` is, or sits inside, a code folder: it or an ancestor below the home folder holds `.git`
 * or `.tenon/workspace.json`. Vault writes there would land next to code, so the picker refuses it. The home
 * folder itself is not checked, since a dotfiles repository there would otherwise refuse every folder.
 */
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
