// Acceptance tests for AC-1, AC-3, AC-4.
// Run from tenon/packages/app: bun test src/features/command-centre/command-centre-bugs.test.ts
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"
import { commandBackState, threadBack } from "./thread-back"
import { crewGroups, type CrewAgent } from "./hub-model"

describe("AC-1 threadBack", () => {
  test("a thread opened from the Command Centre goes back through history", () => {
    expect(threadBack({ state: commandBackState("/command?project=p1"), commandThread: false })).toEqual({
      type: "history",
    })
    expect(threadBack({ state: commandBackState("/command"), commandThread: true })).toEqual({ type: "history" })
  })

  test("a Command Centre thread opened another way goes to the hub", () => {
    expect(threadBack({ state: undefined, commandThread: true })).toEqual({ type: "href", href: "/command" })
    expect(threadBack({ state: { fromNotes: true }, commandThread: true })).toEqual({ type: "href", href: "/command" })
  })

  test("any other thread has no back", () => {
    expect(threadBack({ state: undefined, commandThread: false })).toBeUndefined()
    expect(threadBack({ state: null, commandThread: false })).toBeUndefined()
  })

  test("commandBackState carries the screen it came from", () => {
    expect(commandBackState("/command?project=p1")).toEqual({ commandBack: "/command?project=p1" })
  })
})

const agent = (id: string, state: CrewAgent["state"]): CrewAgent => ({
  id,
  title: id,
  harness: "claude-code",
  state,
  commandCentre: true,
  updated: 0,
})

describe("AC-4 crewGroups", () => {
  test("splits working from finished, needs first", () => {
    const groups = crewGroups([
      agent("a", "running"),
      agent("b", "done"),
      agent("c", "needs"),
      agent("d", "running"),
      agent("e", "done"),
    ])
    expect(groups.working.map((item) => item.id)).toEqual(["c", "a", "d"])
    expect(groups.finished.map((item) => item.id)).toEqual(["b", "e"])
  })

  test("empty crew", () => {
    expect(crewGroups([])).toEqual({ working: [], finished: [] })
  })
})

describe("AC-3 no dead animate-spin", () => {
  const root = join(import.meta.dir, "../..")
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : []
    })

  test("no app component uses animate-spin, which the theme does not define", () => {
    const users = files(root).filter((path) => readFileSync(path, "utf8").includes("animate-spin"))
    expect(users).toEqual([])
  })
})
