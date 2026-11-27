import { describe, expect, test } from "bun:test"
import { activeTurn, agentPanelOpener } from "./agent-panel"

const user = (id: string) => ({ id, role: "user", time: { created: 1 } })
const assistant = (id: string, parentID: string | undefined, completed?: number) => ({
  id,
  role: "assistant",
  parentID,
  time: { created: 2, completed },
})

describe("activeTurn", () => {
  test("a thread with nothing running has no turn", () => {
    expect(activeTurn([])).toBeUndefined()
    expect(activeTurn([user("u1")])).toBeUndefined()
    expect(activeTurn([user("u1"), assistant("a1", "u1", 9)])).toBeUndefined()
  })

  test("a failed reply is not a running turn", () => {
    expect(activeTurn([user("u1"), { ...assistant("a1", "u1"), error: { name: "x" } }])).toBeUndefined()
  })

  test("every step of one reply shares the turn of the message it answers", () => {
    expect(activeTurn([user("u1"), assistant("a1", "u1", 9), assistant("a2", "u1")])).toBe("u1")
  })

  test("the newest running reply names the turn", () => {
    expect(activeTurn([user("u1"), assistant("a1", "u1"), user("u2"), assistant("a2", "u2")])).toBe("u2")
  })

  test("a running reply without a parent is its own turn", () => {
    expect(activeTurn([assistant("a1", undefined)])).toBe("a1")
  })
})

describe("agentPanelOpener", () => {
  test("tool use in a thread that is not working opens nothing", () => {
    const shouldOpen = agentPanelOpener()
    expect(shouldOpen(undefined, "browser")).toBe(false)
    expect(shouldOpen(undefined, "device")).toBe(false)
  })

  test("the first browser call of a turn opens Browser, later calls do not", () => {
    const shouldOpen = agentPanelOpener()
    expect(shouldOpen("u1", "browser")).toBe(true)
    expect(shouldOpen("u1", "browser")).toBe(false)
    expect(shouldOpen("u1", "browser")).toBe(false)
  })

  test("moving to the emulator in the same turn opens Device once", () => {
    const shouldOpen = agentPanelOpener()
    expect(shouldOpen("u1", "browser")).toBe(true)
    expect(shouldOpen("u1", "device")).toBe(true)
    expect(shouldOpen("u1", "device")).toBe(false)
  })

  test("the next turn opens it again", () => {
    const shouldOpen = agentPanelOpener()
    expect(shouldOpen("u1", "browser")).toBe(true)
    expect(shouldOpen("u2", "browser")).toBe(true)
  })

  test("a call with no running turn does not use up the next turn's opening", () => {
    const shouldOpen = agentPanelOpener()
    expect(shouldOpen(undefined, "browser")).toBe(false)
    expect(shouldOpen("u1", "browser")).toBe(true)
  })
})
