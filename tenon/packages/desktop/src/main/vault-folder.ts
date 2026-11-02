import { existsSync } from "node:fs"
import path from "node:path"

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
