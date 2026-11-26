import { describe, expect, test } from "bun:test"
import { todoDockMaxHeight } from "./session-todo-dock"

describe("todoDockMaxHeight", () => {
  test("does not clip an open dock before its list is measured", () => {
    expect(todoDockMaxHeight(undefined, 0)).toBeUndefined()
  })

  test("keeps a collapsed dock at one row before its list is measured", () => {
    expect(todoDockMaxHeight(undefined, 1)).toBe("36px")
  })

  test("animates between the measured list and one row", () => {
    expect(todoDockMaxHeight(128, 0)).toBe("128px")
    expect(todoDockMaxHeight(128, 0.5)).toBe("82px")
    expect(todoDockMaxHeight(128, 1)).toBe("36px")
    expect(todoDockMaxHeight(20, 0)).toBe("36px")
  })
})
