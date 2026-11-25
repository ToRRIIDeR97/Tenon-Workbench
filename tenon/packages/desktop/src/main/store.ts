import Store from "electron-store"
import electron from "electron"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { SETTINGS_STORE } from "./store-keys"
import { deleteStoreFileIfEmpty } from "./store-cleanup"
import { createWriteBehindStore } from "./write-behind-store"

const cache = new Map<string, Store>()

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
