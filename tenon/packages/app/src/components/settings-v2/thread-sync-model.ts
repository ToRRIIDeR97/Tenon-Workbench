import type { ThreadSyncDesktopStatus } from "@/context/platform"

export type StoredThreadLocal = "absent" | "behind" | "current" | "ahead" | "diverged"

export type StoredThread = {
  sessionID: string
  title: string
  directory: string
  head: number
  updatedAt: number
  owner: { id: string; name: string }
  mine: boolean
  local: StoredThreadLocal
  folder: string | null
}

export type ServerSyncStatus = {
  ready: boolean
  enabled: boolean
  missing: ReadonlyArray<"key" | "store">
}

export type SyncStep = "secureStorage" | "client" | "signIn" | "key" | "enable" | "done"

export function storedThreadView(thread: StoredThread) {
  return {
    owner: thread.owner.name,
    mine: thread.mine,
    state: `secondBrain.settings.sync.local.${thread.local}` as const,
    canContinue: !thread.mine,
  }
}

export function nextSyncStep(desktop: ThreadSyncDesktopStatus, server: ServerSyncStatus): SyncStep {
  if (!desktop.secureStorage) return "secureStorage"
  if (!desktop.clientId) return "client"
  if (!desktop.signedIn) return "signIn"
  if (!desktop.key) return "key"
  if (!server.ready) return "enable"
  return "done"
}

export function syncErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /([a-z][a-z0-9_]+)$/.exec(message.trim())?.[1] ?? "unknown"
}
