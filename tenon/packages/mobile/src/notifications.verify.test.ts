import { describe, expect, test } from "bun:test"
import { notificationId, shouldNotify } from "./notifications"

describe("AC-31 phone notifications (verification)", () => {
  test("an empty key still gives a valid id", () => {
    const id = notificationId("")
    expect(Number.isInteger(id)).toBe(true)
    expect(id).toBeGreaterThan(0)
  })

  test("a visible but unfocused app still counts as in view on the phone", () => {
    expect(shouldNotify({ visible: true, focused: false })).toBe(false)
  })

  test("many different keys rarely collide", () => {
    const ids = new Set(Array.from({ length: 2000 }, (_, i) => notificationId(`ses_${i}:done`)))
    expect(ids.size).toBeGreaterThan(1995)
  })
})
