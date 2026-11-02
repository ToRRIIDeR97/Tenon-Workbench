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
