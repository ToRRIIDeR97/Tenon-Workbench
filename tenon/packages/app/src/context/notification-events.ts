import type { EventSessionError } from "@opencode-ai/sdk/v2"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"

type SessionError = EventSessionError["properties"]["error"]

export type NotificationTrigger =
  | { type: "turn-complete"; sessionID?: string }
  | { type: "error"; sessionID?: string; error?: SessionError }
  | { type: "permission"; sessionID?: string; request: PermissionRequest }
  | { type: "question"; sessionID?: string }

// What core's runner sends in session.next.step.failed when the user presses Stop (runner/llm.ts).
const USER_INTERRUPT = "Provider turn interrupted"

/**
 * Turns a server event into the alert it should raise. Composer turns end with V2 step events and never
 * publish session.idle or session.error; routine and command threads on the legacy runner publish only those.
 * `failed` holds sessions whose turn already ended in an error or Stop, so its closing event stays quiet.
 */
export function notificationTrigger(
  event: { type: string; properties?: unknown },
  failed: Set<string>,
): NotificationTrigger | undefined {
  const properties = (event.properties ?? {}) as {
    sessionID?: string
    status?: { type?: string }
    error?: SessionError
    finish?: string
  }
  const sessionID = properties.sessionID
  const settle = () => {
    if (!sessionID || !failed.delete(sessionID)) return { type: "turn-complete" as const, sessionID }
  }
  const fail = () => sessionID && failed.add(sessionID)

  switch (event.type) {
    case "session.status":
      if (sessionID && properties.status?.type === "busy") failed.delete(sessionID)
      return
    case "session.next.step.started":
      if (sessionID) failed.delete(sessionID)
      return
    case "session.idle":
      return settle()
    case "session.next.step.ended":
      return properties.finish === "tool-calls" ? undefined : settle()
    case "session.error":
      // With auto-compaction an overflow does not end the turn, so its session.idle still counts.
      if (properties.error?.name !== "ContextOverflowError") fail()
      if (properties.error?.name === "MessageAbortedError") return
      return { type: "error", sessionID, error: properties.error }
    case "session.next.step.failed": {
      fail()
      const message = (properties.error as { message?: string } | undefined)?.message
      if (message === USER_INTERRUPT) return
      return { type: "error", sessionID, error: { name: "UnknownError", data: { message: message ?? "" } } }
    }
    case "permission.asked":
      return { type: "permission", sessionID, request: event.properties as PermissionRequest }
    case "question.asked":
      return { type: "question", sessionID }
  }
}

/** A root thread waiting on the user alerts, unless auto-accept is about to answer the request. */
export function needsAttention(
  trigger: Extract<NotificationTrigger, { type: "permission" | "question" }>,
  session: { parentID?: string } | undefined,
  autoResponds: (request: PermissionRequest) => boolean,
) {
  if (!session || session.parentID) return false
  return trigger.type === "question" || !autoResponds(trigger.request)
}
