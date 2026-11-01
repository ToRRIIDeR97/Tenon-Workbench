import { existsSync, readdirSync, renameSync } from "node:fs"
import { join } from "node:path"

// Store files written before the rename: opencode.settings, opencode.updater and the renderer's
// opencode.<scope>.dat files. Each moves to its tenon.* name once, unless that name already exists.
const LEGACY_STORE = /^opencode\.(settings|updater|.+\.dat)$/

/** Renames pre-rename store files in `userData`. Runs before any store is opened. */
export function renameLegacyStoreFiles(userData: string) {
  const renamed: string[] = []
  for (const name of readdirSync(userData).filter((item) => LEGACY_STORE.test(item))) {
    const target = `tenon.${name.slice("opencode.".length)}`
    if (existsSync(join(userData, target))) continue
    renameSync(join(userData, name), join(userData, target))
    renamed.push(target)
  }
  return renamed
}
