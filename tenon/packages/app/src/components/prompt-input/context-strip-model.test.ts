import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { getSessionTotals, getSubagentUsage, getTurnUsage } from "@/components/session/session-usage"
import { formatResetIn, threadUsage, threadWorktree } from "./context-strip-model"

describe("usage limits", () => {
  test("shows only the thread's own harness, and nothing for one that doesn't report usage", () => {
    const reports = [
      { instanceID: "codex", status: "available" },
      { instanceID: "claude-code", status: "signed-out" },
      { instanceID: "opencode-acp", status: "unsupported" },
    ]
    expect(threadUsage(reports, "claude-code")).toEqual({ instanceID: "claude-code", status: "signed-out" })
    expect(threadUsage(reports, "opencode-acp")).toBeUndefined()
    expect(threadUsage(reports, "opencode")).toBeUndefined()
    expect(threadUsage(reports, undefined)).toBeUndefined()
  })

  test("says how far off a reset is in minutes, hours, or days", () => {
    const now = 1_000_000
    expect(formatResetIn(now + 20 * 60_000, now, "en")).toBe("in 20 minutes")
    expect(formatResetIn(now + 3 * 3_600_000, now, "en")).toBe("in 3 hours")
    expect(formatResetIn(now + 5 * 86_400_000, now, "en")).toBe("in 5 days")
    expect(formatResetIn(now - 60_000, now, "en")).toBe("in 1 minute")
    expect(formatResetIn(now + 3 * 3_600_000, now, "de")).toBe("in 3 Stunden")
  })
})

const project = { worktree: "/work/repo", sandboxes: ["/work/.worktrees/quirky-thompson", "/tmp/clone/"] }

describe("context strip worktree", () => {
  test("names a linked worktree after its folder", () => {
    expect(threadWorktree({ directory: "/work/.worktrees/quirky-thompson/", project })).toEqual({
      name: "quirky-thompson",
      linked: true,
    })
    expect(threadWorktree({ directory: "/tmp/clone", project })).toEqual({ name: "clone", linked: true })
  })

  test("shows the folder name for the main checkout and folders outside Git", () => {
    expect(threadWorktree({ directory: "/work/repo", project })).toEqual({ name: "repo", linked: false })
    expect(threadWorktree({ directory: "C:\\work\\notes", project: undefined })).toEqual({
      name: "notes",
      linked: false,
    })
    expect(threadWorktree({ directory: undefined, project })).toBeUndefined()
  })
})

describe("turn usage", () => {
  const assistant = (read: number, input: number, output: number) =>
    ({ role: "assistant", tokens: { input, output, reasoning: 0, cache: { read, write: 0 } } }) as Message
  const user = { role: "user" } as Message

  test("counts only the messages since the last user message", () => {
    const usage = getTurnUsage([
      user,
      assistant(9000, 1000, 100),
      user,
      assistant(3000, 1000, 50),
      assistant(3600, 400, 50),
    ])
    expect(usage.cacheHit).toBe(0.825)
    expect(usage.total).toBe(8100)
  })

  test("reports no hit rate before the turn has a reply", () => {
    expect(getTurnUsage([assistant(9000, 1000, 100), user]).cacheHit).toBeUndefined()
  })
})

describe("session totals", () => {
  const tokens = (input: number) => ({ input, output: 10, reasoning: 0, cache: { read: 0, write: 0 } })
  const loaded = [{ role: "assistant", cost: 0.5, tokens: tokens(100) } as Message]

  test("uses the server's whole-session totals over the loaded messages", () => {
    const totals = getSessionTotals({ cost: 4, tokens: tokens(5000) }, loaded)
    expect(totals.total).toBe(5010)
    expect(totals.cost).toBe(4)
    expect(getSessionTotals(undefined, loaded).total).toBe(110)
    expect(getSessionTotals(undefined, loaded).cost).toBe(0.5)
  })

  test("sums ACP subagent usage and cached task children, counting the children it can't see", () => {
    const tool = (id: string, name: string, metadata: Record<string, unknown>, state: Record<string, unknown> = {}) =>
      ({
        id,
        type: "tool",
        tool: name,
        metadata,
        state: { status: "completed", input: {}, ...state },
      }) as unknown as Part
    const parts = [
      tool("a", "acp_subagent", {
        acpSubagent: { transcript: [], usage: { inputTokens: 100, outputTokens: 20, cost: 0.1 } },
      }),
      tool("b", "acp_subagent", { acpSubagent: { transcript: [], usage: { inputTokens: 50 } } }),
      tool("c", "task", {}, { metadata: { sessionId: "child" } }),
      tool("d", "task", {}, { metadata: { sessionId: "unloaded" } }),
    ]
    const usage = getSubagentUsage(
      [{ id: "m", role: "assistant" } as Message],
      (id) => (id === "m" ? parts : []),
      (id) => (id === "child" ? { cost: 0.4, tokens: tokens(1000) } : undefined),
    )
    expect(usage?.total).toBe(1180)
    expect(usage?.cost).toBeCloseTo(0.5)
    expect(usage?.count).toBe(3)
    expect(usage?.missing).toBe(1)
  })
})
