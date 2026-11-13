import { describe, expect, test } from "bun:test"
import {
  boardByProject,
  boardByState,
  FINISHED_WINDOW_MS,
  STEER_LIMIT,
  steerText,
  type BoardThread,
} from "../../../../tenon/packages/app/src/features/command-centre/mission-board"

const now = 1_800_000_000_000
const thread = (id: string, extra: Partial<BoardThread> = {}): BoardThread => ({
  id,
  title: `Thread ${id}`,
  project: "Alpha",
  projectID: "alpha",
  updated: now - 60_000,
  waiting: 0,
  subagents: 0,
  ...extra,
})
const ids = (threads: BoardThread[]) => threads.map((item) => item.id)

describe("AC-1.1 boundaries", () => {
  test("AC-1.1 an empty list gives three empty groups", () => {
    expect(boardByState([], now)).toEqual({ needsYou: [], running: [], finished: [] })
  })

  test("AC-1.1 an idle thread exactly a day old is left out; one millisecond newer is kept", () => {
    const board = boardByState(
      [thread("edge", { updated: now - FINISHED_WINDOW_MS }), thread("inside", { updated: now - FINISHED_WINDOW_MS + 1 })],
      now,
    )
    expect(ids(board.finished)).toEqual(["inside"])
  })

  test("AC-1.1 a waiting thread with no status still needs you, however old", () => {
    const board = boardByState([thread("question", { waiting: 1, updated: now - 10 * FINISHED_WINDOW_MS })], now)
    expect(ids(board.needsYou)).toEqual(["question"])
    expect(board.finished).toEqual([])
  })

  test("AC-1.1 a running thread is shown however old its last update", () => {
    const board = boardByState([thread("long", { status: "running", updated: now - 5 * FINISHED_WINDOW_MS })], now)
    expect(ids(board.running)).toEqual(["long"])
  })

  test("AC-1.1 ties keep input order and the input is not changed", () => {
    const input = [
      thread("first", { status: "running", updated: now - 5 }),
      thread("second", { status: "running", updated: now - 5 }),
      thread("newest", { status: "running", updated: now - 1 }),
    ]
    const copy = structuredClone(input)
    expect(ids(boardByState(input, now).running)).toEqual(["newest", "first", "second"])
    expect(input).toEqual(copy)
  })

  test("AC-1.1 every kept thread is in exactly one group", () => {
    const input = [
      thread("a", { waiting: 1, status: "approval" }),
      thread("b", { status: "retrying" }),
      thread("c"),
      thread("d", { waiting: 3 }),
    ]
    const board = boardByState(input, now)
    const all = [...board.needsYou, ...board.running, ...board.finished].map((item) => item.id).sort()
    expect(all).toEqual(["a", "b", "c", "d"])
  })
})

describe("AC-1.2 boundaries", () => {
  test("AC-1.2 project names sort ignoring case, and General is last even when its name sorts first", () => {
    const groups = boardByProject(
      [
        thread("g", { project: "Aardvark general", projectID: undefined }),
        thread("z", { project: "zeta", projectID: "z" }),
        thread("b", { project: "Beta", projectID: "b" }),
        thread("a", { project: "alpha", projectID: "a" }),
      ],
      now,
    )
    expect(groups.map((group) => group.project)).toEqual(["alpha", "Beta", "zeta", "Aardvark general"])
  })

  test("AC-1.2 two projects with the same name stay separate groups", () => {
    const groups = boardByProject(
      [thread("one", { project: "Site", projectID: "site-1" }), thread("two", { project: "Site", projectID: "site-2" })],
      now,
    )
    expect(groups).toHaveLength(2)
    expect(groups.flatMap((group) => ids(group.threads)).sort()).toEqual(["one", "two"])
  })

  test("AC-1.2 an old idle thread is dropped but its project stays when another thread is kept", () => {
    const groups = boardByProject(
      [thread("stale", { updated: now - 3 * FINISHED_WINDOW_MS }), thread("live", { status: "running" })],
      now,
    )
    expect(groups).toHaveLength(1)
    expect(ids(groups[0].threads)).toEqual(["live"])
  })

  test("AC-1.2 no threads gives no groups", () => {
    expect(boardByProject([], now)).toEqual([])
  })
})

describe("AC-1.3 boundaries", () => {
  test("AC-1.3 keeps line breaks inside the text and text at the limit", () => {
    expect(steerText("\nfirst line\nsecond line\n")).toBe("first line\nsecond line")
    expect(steerText("y".repeat(STEER_LIMIT))).toHaveLength(STEER_LIMIT)
  })

  test("AC-1.3 trims before cutting", () => {
    const text = steerText(`   ${"z".repeat(STEER_LIMIT + 10)}`)
    expect(text).toHaveLength(STEER_LIMIT)
    expect(text?.startsWith("z")).toBe(true)
  })
})
