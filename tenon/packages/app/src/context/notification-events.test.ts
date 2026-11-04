import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { needsAttention, notificationTrigger } from "./notification-events"

const event = (type: string, properties: object = {}) => ({ type, properties: { sessionID: "ses", ...properties } })

describe("notificationTrigger", () => {
  test("a V2 turn alerts once, when its last step ends", () => {
    const failed = new Set<string>()
    expect(notificationTrigger(event("session.next.step.ended", { finish: "tool-calls" }), failed)).toBeUndefined()
    expect(notificationTrigger(event("session.next.step.ended", { finish: "stop" }), failed)?.type).toBe(
      "turn-complete",
    )
  })

  test("a V2 failure alerts as an error and its closing step stays quiet", () => {
    const failed = new Set<string>()
    const message = "Rate limited"
    expect(
      notificationTrigger(event("session.next.step.failed", { error: { type: "unknown", message } }), failed),
    ).toEqual({ type: "error", sessionID: "ses", error: { name: "UnknownError", data: { message } } })
    expect(notificationTrigger(event("session.next.step.ended", { finish: "stop" }), failed)).toBeUndefined()
  })

  test("Stop raises nothing on either runner", () => {
    const failed = new Set<string>()
    const interrupted = { error: { type: "unknown", message: "Provider turn interrupted" } }
    expect(notificationTrigger(event("session.next.step.failed", interrupted), failed)).toBeUndefined()
    notificationTrigger(event("session.next.step.started"), failed)

    const aborted = { error: { name: "MessageAbortedError", data: { message: "Aborted" } } }
    expect(notificationTrigger(event("session.error", aborted), failed)).toBeUndefined()
    expect(notificationTrigger(event("session.idle"), failed)).toBeUndefined()
  })

  test("a legacy error replaces its idle alert, and the next turn alerts again", () => {
    const failed = new Set<string>()
    const error = { name: "UnknownError", data: { message: "Boom" } }
    expect(notificationTrigger(event("session.error", { error }), failed)?.type).toBe("error")
    expect(notificationTrigger(event("session.idle"), failed)).toBeUndefined()

    notificationTrigger(event("session.error", { error }), failed)
    notificationTrigger(event("session.status", { status: { type: "busy" } }), failed)
    expect(notificationTrigger(event("session.idle"), failed)?.type).toBe("turn-complete")
  })

  test("an overflow that compaction recovers from is no error, and its turn still completes", () => {
    const failed = new Set<string>()
    const overflow = { error: { name: "ContextOverflowError", data: {} } }
    expect(notificationTrigger(event("session.error", overflow), failed)).toBeUndefined()
    expect(notificationTrigger(event("session.idle"), failed)?.type).toBe("turn-complete")
  })
})

describe("needsAttention", () => {
  const request = { sessionID: "ses" } as PermissionRequest
  const permission = { type: "permission" as const, sessionID: "ses", request }

  test("skips child threads and requests auto-accept answers", () => {
    expect(needsAttention(permission, { parentID: "root" }, () => false)).toBe(false)
    expect(needsAttention(permission, {}, () => true)).toBe(false)
    expect(needsAttention(permission, {}, () => false)).toBe(true)
  })

  test("questions always need the user", () => {
    expect(needsAttention({ type: "question", sessionID: "ses" }, {}, () => true)).toBe(true)
  })
})
