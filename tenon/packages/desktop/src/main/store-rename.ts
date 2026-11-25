import { existsSync, readdirSync, renameSync } from "node:fs"
import { join } from "node:path"

const LEGACY_STORE = /^opencode\.(settings|updater|.+\.dat)$/

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
