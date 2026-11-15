import { describe, expect, test } from "bun:test"
import {
  boardByProject,
  boardByState,
  FINISHED_WINDOW_MS,
  STEER_LIMIT,
  steerText,
  type BoardThread,
} from "../../../../tenon/packages/app/src/features/command-centre/mission-board"

const now = Date.UTC(2026, 10, 13, 12)
const hour = 3_600_000
const thread = (id: string, extra: Partial<BoardThread> = {}): BoardThread => ({
  id,
  title: id,
  project: "Tenon",
  projectID: "p-tenon",
  updated: now - hour,
  waiting: 0,
  subagents: 0,
  ...extra,
})
const ids = (threads: BoardThread[]) => threads.map((item) => item.id)

describe("AC-1.1 board by state", () => {
  test("AC-1.1 sorts threads into needs you, running and finished", () => {
    const board = boardByState(
      [
        thread("idle-old", { updated: now - 3 * 24 * hour }),
        thread("approval", { status: "approval", waiting: 1 }),
        thread("running-older", { status: "running", updated: now - 2 * hour }),
        thread("retrying-newer", { status: "retrying", updated: now - hour }),
        thread("idle-recent", { updated: now - 2 * hour }),
      ],
      now,
    )
    expect(ids(board.needsYou)).toEqual(["approval"])
    expect(ids(board.running)).toEqual(["retrying-newer", "running-older"])
    expect(ids(board.finished)).toEqual(["idle-recent"])
  })

  test("AC-1.1 a thread waiting on the user is only under needs you, even while running", () => {
    const board = boardByState([thread("both", { status: "running", waiting: 2 })], now)
    expect(ids(board.needsYou)).toEqual(["both"])
    expect(board.running).toEqual([])
  })

  test("AC-1.1 the finished window is a day", () => {
    expect(FINISHED_WINDOW_MS).toBe(24 * hour)
  })
})

describe("AC-1.2 board by project", () => {
  test("AC-1.2 groups by project, General last, most urgent first inside a group", () => {
    const groups = boardByProject(
      [
        thread("general-run", { project: "General", projectID: undefined, status: "running" }),
        thread("tenon-idle", { updated: now - hour }),
        thread("tenon-wait", { waiting: 1, updated: now - 5 * hour }),
        thread("harness-run", { project: "Harness-Sync", projectID: "p-harness", status: "running" }),
        thread("tenon-run", { status: "running", updated: now - 3 * hour }),
      ],
      now,
    )
    expect(groups.map((group) => group.project)).toEqual(["Harness-Sync", "Tenon", "General"])
    expect(ids(groups[1].threads)).toEqual(["tenon-wait", "tenon-run", "tenon-idle"])
    expect(groups[2].projectID).toBeUndefined()
  })

  test("AC-1.2 leaves out a project whose threads are all old and idle", () => {
    const groups = boardByProject([thread("stale", { updated: now - 2 * 24 * hour })], now)
    expect(groups).toEqual([])
  })
})

describe("AC-1.3 steer text", () => {
  test("AC-1.3 trims, and sends nothing for blank text", () => {
    expect(steerText("  run the tests first  ")).toBe("run the tests first")
    expect(steerText("   \n\t ")).toBeUndefined()
    expect(steerText("")).toBeUndefined()
  })

  test("AC-1.3 cuts very long text to the limit", () => {
    expect(steerText("x".repeat(STEER_LIMIT + 50))).toHaveLength(STEER_LIMIT)
  })
})
