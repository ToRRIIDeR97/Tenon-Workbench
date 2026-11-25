import { describe, expect, test } from "bun:test"
import { threadBack } from "./thread-back"
import { crewGroups, type CrewAgent } from "./hub-model"

describe("threadBack edge cases", () => {
  test("a malformed commandBack counts as absent", () => {
    expect(threadBack({ state: { commandBack: 3 }, commandThread: false })).toBeUndefined()
    expect(threadBack({ state: { commandBack: "" }, commandThread: true })).toEqual({ type: "href", href: "/command" })
    expect(threadBack({ state: "x", commandThread: false })).toBeUndefined()
  })
})

describe("crewGroups edge cases", () => {
  test("does not reorder or mutate its input", () => {
    const input: CrewAgent[] = [
      { id: "a", title: "a", harness: "h", state: "running", commandCentre: false, updated: 2 },
      { id: "b", title: "b", harness: "h", state: "needs", commandCentre: false, updated: 1 },
    ]
    const copy = structuredClone(input)
    crewGroups(input)
    expect(input).toEqual(copy)
  })
})
