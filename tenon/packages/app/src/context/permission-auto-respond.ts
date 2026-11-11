import { base64Encode } from "@tenon/core/util/encode"

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function accepted(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  const key = acceptKey(sessionID, directory)
  return autoAccept[key] ?? autoAccept[sessionID]
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  const key = directoryAcceptKey(directory)
  return autoAccept[key] ?? false
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function autoRespondsPermission(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  const value = sessionAutoAccept(autoAccept, session, permission, directory)
  if (value !== undefined) return value
  return directory ? isDirectoryAutoAccepting(autoAccept, directory) : false
}

export function sessionAutoAccept(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  return sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
}

/** Ask: every request waits. Auto-edit: file edits run. Full auto: everything inside the folder runs. */
export type PermissionMode = "ask" | "edit" | "full"

/**
 * The mode for a session: its own choice or its nearest parent's (a subagent follows its thread), else the
 * folder's. Full auto wins over auto-edit.
 */
export function permissionMode(
  stores: { full: Record<string, boolean>; edit: Record<string, boolean> },
  session: { id: string; parentID?: string }[],
  sessionID: string,
  directory?: string,
): PermissionMode {
  if (autoRespondsPermission(stores.full, session, { sessionID }, directory)) return "full"
  if (autoRespondsPermission(stores.edit, session, { sessionID }, directory)) return "edit"
  return "ask"
}

/** Whether a mode answers a request without asking. Reaching outside the folder always asks. */
export function modeAllows(mode: PermissionMode, permission: { permission: string }) {
  if (permission.permission === "external_directory") return false
  if (mode === "full") return true
  return mode === "edit" && permission.permission === "edit"
}
