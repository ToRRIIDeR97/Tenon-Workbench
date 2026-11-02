import { describe, expect, test } from "bun:test"
import type { AgentWrite } from "@/features/agent-writes/store"
import { commandDirectoryFor, compactionDue, modelChoice, sameDirectory, turnWrites } from "./command-centre"

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
