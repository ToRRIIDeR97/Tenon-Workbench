import { app, net, safeStorage, shell } from "electron"
import { decryptSecret, encryptSecret } from "../secret-storage"
import { getStore } from "../store"
import { createThreadSyncService, GOOGLE_ENDPOINTS } from "./service"
import { testEndpoints } from "./endpoints"

const STORE_NAME = "tenon.thread-sync"

export function createDesktopThreadSync() {
  const test = testEndpoints(process.env, app.isPackaged)
  const store = getStore(STORE_NAME)
  return createThreadSyncService({
    secrets: {
      available: async () => {
        if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
        return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"
      },
      encrypt: (value) => encryptSecret(safeStorage, value),
      decrypt: (value) => decryptSecret(safeStorage, value),
    },
    store: {
      get: (key) => store.get(key),
      set: (key, value) => store.set(key, value),
      delete: (key) => store.delete(key),
    },
    fetch: (url, init) => net.fetch(url.toString(), init),
    openExternal: (url) => shell.openExternal(url),
    endpoints: test?.oauth ?? GOOGLE_ENDPOINTS,
  })
}

export function threadSyncServerEnv() {
  const test = testEndpoints(process.env, app.isPackaged)
  return { TENON_THREAD_SYNC_DRIVE_ENDPOINT: test?.drive ?? "" }
}
