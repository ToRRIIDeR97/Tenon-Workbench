import { describe, expect, test } from "bun:test"
import { posix } from "path"
import { configEntryNameFromPath } from "@/config/entry-name"

const AGENT_PREFIXES = ["agent/", "agents/"]

describe("configEntryNameFromPath", () => {
  test("strips an `agents/` prefix and returns the bare name", () => {
    expect(configEntryNameFromPath("agents/build.md", AGENT_PREFIXES)).toBe("build")
  })

  test("strips an `agent/` (singular) prefix", () => {
    expect(configEntryNameFromPath("agent/build.md", AGENT_PREFIXES)).toBe("build")
  })

  test("preserves nested subdirectories in the key", () => {
    expect(configEntryNameFromPath("agents/team/build.md", AGENT_PREFIXES)).toBe("team/build")
  })

  test("normalizes Windows-style backslashes", () => {
    expect(configEntryNameFromPath("agents\\team\\build.md", AGENT_PREFIXES)).toBe("team/build")
  })

  test("falls back to basename when no prefix matches", () => {
    expect(configEntryNameFromPath("orphaned.md", AGENT_PREFIXES)).toBe("orphaned")
    expect(configEntryNameFromPath("anywhere/orphaned.md", [])).toBe("orphaned")
  })

  test("regression #25713: caller passes relative path; parent /agent/ segment is irrelevant", () => {
    const dir = "/home/agent/.config/opencode"
    const item = "/home/agent/.config/opencode/agents/build.md"
    const relative = posix.relative(dir, item)
    expect(relative).toBe("agents/build.md")
    expect(configEntryNameFromPath(relative, AGENT_PREFIXES)).toBe("build")
  })

  test("regression #25713: parent /agents/ segment is irrelevant", () => {
    const dir = "/srv/agents/team/.config/opencode"
    const item = "/srv/agents/team/.config/opencode/agents/build.md"
    const relative = posix.relative(dir, item)
    expect(configEntryNameFromPath(relative, AGENT_PREFIXES)).toBe("build")
  })
})
