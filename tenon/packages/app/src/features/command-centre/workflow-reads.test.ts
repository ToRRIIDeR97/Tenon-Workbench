import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import type { CommandTranscript } from "./command-centre"
import type { Report } from "./workflow-runs"
import { completedReports, runUsage } from "./workflow-reads"

type Entry = { id: string; role: "user" | "assistant"; completed?: number; text: string; cost?: number }
const tokens = { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
const transcript = (entries: Entry[]): CommandTranscript => ({
  message: {
    thread: entries.map(
      (entry) =>
        ({
          id: entry.id,
          role: entry.role,
          time: { created: 1, completed: entry.completed },
          cost: entry.cost,
          tokens,
        }) as unknown as Message,
    ),
  },
  part: Object.fromEntries(
    entries.map((entry) => [entry.id, [{ id: `${entry.id}-0`, type: "text", text: entry.text } as Part]]),
  ),
  part_text_accum_delta: {},
})

describe("reports in the director's finished messages", () => {
  const data = transcript([
    { id: "u1", role: "user", text: "[[round 9 | reviewer | approved]] the user's own text" },
    { id: "a1", role: "assistant", completed: 2, text: "[[round 1 | implementor | done]] Changed it" },
    { id: "a2", role: "assistant", text: "[[round 2 | implementor | started]] still streaming" },
  ])

  test("a user message never counts and a message still streaming contributes nothing", () => {
    expect(completedReports(data, "thread", new Map())).toEqual([
      { round: 1, role: "implementor", status: "done", summary: "Changed it" },
    ])
  })

  test("the streaming message counts once it completes, and each finished message is parsed once", () => {
    const cache = new Map<string, Report[]>()
    const read: string[] = []
    // Counts the parts each call reads: a cached message must not be read again.
    const tracked = (value: CommandTranscript) => ({
      ...value,
      part: new Proxy(value.part, { get: (part, id: string) => (read.push(id), part[id]) }),
    })
    completedReports(tracked(data), "thread", cache)
    completedReports(tracked(data), "thread", cache)
    expect(read).toEqual(["a1"])

    const done = transcript([
      { id: "u1", role: "user", text: "[[round 9 | reviewer | approved]] the user's own text" },
      { id: "a1", role: "assistant", completed: 2, text: "[[round 1 | implementor | done]] Changed it" },
      { id: "a2", role: "assistant", completed: 3, text: "[[round 2 | implementor | started]] now finished" },
    ])
    read.length = 0
    const reports = completedReports(tracked(done), "thread", cache)
    expect(reports.map((report) => report.round)).toEqual([1, 2])
    expect(read).toEqual(["a2"])
  })

  test("a thread that is not loaded has no reports", () => {
    expect(completedReports(data, "missing", new Map())).toEqual([])
  })
})

describe("what a run has cost", () => {
  const info = (id: string, extra: { parentID?: string; cost?: number } = {}) => ({ id, tokens, ...extra })

  test("a thread's own cost is used, and the threads under the director are added", () => {
    const usage = runUsage(
      [info("dir", { cost: 0.5 }), info("kid", { parentID: "dir", cost: 1 }), info("other", { cost: 9 })],
      {},
      "dir",
    )
    expect(usage.spent).toBeCloseTo(1.5)
    expect(usage.reported).toBe(true)
  })

  test("a thread whose session info carries no cost falls back to the sum of its messages' costs", () => {
    const messages = transcript([
      { id: "a1", role: "assistant", completed: 2, text: "x", cost: 0.25 },
      { id: "a2", role: "assistant", completed: 3, text: "y", cost: 0.5 },
    ]).message
    const usage = runUsage([info("thread", { cost: 0 })], messages, "thread")
    expect(usage.spent).toBeCloseTo(0.75)
    expect(usage.reported).toBe(true)
  })

  test("when no thread of the run reports a cost, the spend is not reported rather than 0 spent", () => {
    const messages = transcript([{ id: "a1", role: "assistant", completed: 2, text: "x" }]).message
    const usage = runUsage([info("thread"), info("kid", { parentID: "thread", cost: 0 })], messages, "thread")
    expect(usage.spent).toBe(0)
    expect(usage.reported).toBe(false)
    expect(runUsage([], {}, "thread")).toEqual({ spent: 0, reported: false })
  })
})
