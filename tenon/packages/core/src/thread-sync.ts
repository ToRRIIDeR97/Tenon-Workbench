export * as ThreadSync from "./thread-sync"

export { SyncError } from "./thread-sync/error"
export type { Code } from "./thread-sync/error"
export { generateKey, keyFromPhrase, open, seal } from "./thread-sync/crypto"
export type { Store } from "./thread-sync/store"
export { folderStore } from "./thread-sync/folder"
export { gcsStore } from "./thread-sync/gcs"
export { make } from "./thread-sync/engine"
