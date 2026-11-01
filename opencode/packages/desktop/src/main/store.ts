import Store from "electron-store"
import electron from "electron"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { SETTINGS_STORE } from "./store-keys"
import { deleteStoreFileIfEmpty } from "./store-cleanup"
import { createWriteBehindStore } from "./write-behind-store"

const cache = new Map<string, Store>()

// We cannot instantiate the electron-store at module load time because
// module import hoisting causes this to run before app.setPath("userData", ...)
// in index.ts has executed, which would result in files being written to the default directory
// (e.g. bad: %APPDATA%\@opencode-ai\desktop\opencode.settings vs good: %APPDATA%\ai.opencode.desktop.dev\opencode.settings).
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = new Store({
    name,
    cwd: electron.app.getPath("userData"),
    fileExtension: "",
    accessPropertiesByDotNotation: false,
  })
  cache.set(name, next)
  return next
}

// Renderer stores (store-* IPC). Main-owned stores keep using getStore directly.
export const rendererStore = createWriteBehindStore({
  read: (name) => getStore(name).store,
  write: (name, data) => {
    getStore(name).store = data
  },
})

export async function removeStoreFileIfEmpty(name: string) {
  if (!(await deleteStoreFileIfEmpty(electron.app.getPath("userData"), name))) return
  cache.delete(name)
  rendererStore.forget(name)
}

export function removeStoreFile(name: string) {
  rendererStore.forget(name)
  rmSync(join(electron.app.getPath("userData"), name), { force: true })
  cache.delete(name)
}
