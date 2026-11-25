export const SERVER_EVENT_NAMES = {
  connected: "server.connected",
  disposed: "global.disposed",
  moved: "session.next.moved",
  revert: ["session.next.revert.staged", "session.next.revert.cleared", "session.next.revert.committed"],
} as const

const LEGACY_REVERT = new Set(["session.revert.staged", "session.revert.cleared", "session.revert.committed"])

export function isSessionMovedEvent(type: string | undefined) {
  return type === SERVER_EVENT_NAMES.moved || type === "session.moved"
}

export function isSessionRevertEvent(type: string | undefined) {
  if (!type) return false
  return (SERVER_EVENT_NAMES.revert as readonly string[]).includes(type) || LEGACY_REVERT.has(type)
}

export function sessionMovedData(value: unknown) {
  if (!isRecord(value) || typeof value.sessionID !== "string") return undefined
  if (!isRecord(value.location) || typeof value.location.directory !== "string") return undefined
  return {
    sessionID: value.sessionID,
    directory: value.location.directory,
    workspaceID: optionalString(value.location.workspaceID),
    projectID: optionalString(value.projectID),
    path: optionalString(value.subpath) ?? optionalString(value.subdirectory),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined
}
