import { describe, expect, test } from "bun:test"
import { notificationId, shouldNotify } from "./notifications"

describe("AC-31 phone notifications", () => {
  test("ids are stable positive 31-bit integers", () => {
    const id = notificationId("ses_abc:permission")
    expect(id).toBe(notificationId("ses_abc:permission"))
    expect(id).toBeGreaterThan(0)
    expect(id).toBeLessThanOrEqual(2 ** 31 - 1)
    expect(notificationId("ses_abc:done")).not.toBe(id)
  })

  test("only notifies when the app is not in view", () => {
    expect(shouldNotify({ visible: true, focused: true })).toBe(false)
    expect(shouldNotify({ visible: false, focused: false })).toBe(true)
  })
})
