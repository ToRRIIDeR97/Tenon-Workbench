import { describe, expect, test } from "bun:test"
import type { AgentWrite } from "@/features/agent-writes/store"
import {
  commandDirectoryFor,
  compactionDue,
  modelChoice,
  sameDirectory,
  threadLabel,
  threadWorking,
  turnWrites,
} from "./command-centre"

const DAY = 24 * 60 * 60 * 1000

describe("Command Centre helpers", () => {
  test("the threads folder keeps the root's separator style", () => {
    expect(commandDirectoryFor("C:\\Users\\me\\Documents\\Tenon")).toBe(
      "C:\\Users\\me\\Documents\\Tenon\\.command-centre",
    )
    expect(commandDirectoryFor("/Users/me/Documents/Tenon/")).toBe("/Users/me/Documents/Tenon/.command-centre")
  })

  test("directories compare across separators, and Windows paths without letter case", () => {
    expect(sameDirectory("C:\\Users\\Me\\Tenon\\.command-centre", "c:/users/me/tenon/.command-centre/")).toBe(true)
    expect(sameDirectory("/Users/Me/Tenon", "/users/me/tenon")).toBe(false)
    expect(sameDirectory(undefined, "/a")).toBe(false)
  })

  test("compaction runs at most once a day", () => {
    const now = 10 * DAY
    expect(compactionDue(undefined, now)).toBe(true)
    expect(compactionDue(now - DAY + 1, now)).toBe(false)
    expect(compactionDue(now - DAY, now)).toBe(true)
  })

  test("a model id splits into provider and model at the first slash", () => {
    expect(modelChoice("openrouter/anthropic/claude")).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude",
    })
    expect(modelChoice("plain")).toBeUndefined()
    expect(modelChoice(undefined)).toBeUndefined()
  })

  test("a turn's writes are those since its latest user message", () => {
    const write = (id: string, at: number) => ({ id, at }) as AgentWrite
    const writes = [write("a", 100), write("b", 200), write("c", 300)]
    expect(turnWrites(writes, 200).map((item) => item.id)).toEqual(["b", "c"])
    expect(turnWrites(writes, undefined).map((item) => item.id)).toEqual(["a", "b", "c"])
  })
})

describe("Command Centre threads", () => {
  test("a default title falls back to the first message, cut to one line", () => {
    expect(threadLabel("Plan the week", "ignored")).toBe("Plan the week")
    expect(threadLabel("New session - 2026-11-03T17:01:02.000Z", "  What's\non today?  ")).toBe("What's on today?")
    expect(threadLabel("New session - 2026-11-03T17:01:02.000Z", undefined)).toBe("")
    expect(threadLabel("New session - 2026-11-03T17:01:02.000Z", "a".repeat(100))).toHaveLength(80)
  })

  test("a thread is working while busy, mid-reply, or just sent", () => {
    expect(threadWorking("busy", [])).toBe(true)
    expect(threadWorking("idle", [{ role: "assistant", done: true }])).toBe(false)
    expect(threadWorking(undefined, [{ role: "user", done: true }])).toBe(true)
    expect(threadWorking("idle", [{ role: "user", done: true }])).toBe(false)
    expect(threadWorking("idle", [{ role: "assistant", done: false }])).toBe(true)
  })
})
