import { describe, expect, test } from "bun:test"
import { sessionTitle } from "./session-title"

describe("sessionTitle", () => {
  test("shows a default title as New thread, without its timestamp", () => {
    expect(sessionTitle("New session - 2026-11-04T07:13:40.200Z")).toBe("New thread")
    expect(sessionTitle("Child session - 2026-11-04T07:13:40.200Z")).toBe("Child thread")
  })

  test("keeps a real title", () => {
    expect(sessionTitle("Fix the build")).toBe("Fix the build")
    expect(sessionTitle(undefined)).toBeUndefined()
  })
})
