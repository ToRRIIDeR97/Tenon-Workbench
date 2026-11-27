import { describe, expect, test } from "bun:test"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { dict as en } from "@/i18n/en"
import {
  assignRunKeys,
  blockedNote,
  foldDuration,
  hasVisibleSteps,
  reasoningTopic,
  sameDiffs,
  sameFileDiff,
  stepKeys,
  subagentLanes,
  tickerStep,
  toolDetail,
  turnDuration,
} from "./turn-steps-summary"
import { editDiffs } from "./step-diff"

const tool = (
  id: string,
  status: "pending" | "running" | "completed" | "error",
  name = "read",
  metadata?: Record<string, unknown>,
) => ({ id, type: "tool", tool: name, state: { status, input: {} }, metadata }) as unknown as Part
const text = (id: string) => ({ id, type: "text", text: "" }) as unknown as Part
const reasoning = (id: string, end?: number) =>
  ({ id, type: "reasoning", text: "Thinking it over.", time: { start: 1, end } }) as unknown as Part

describe("tickerStep", () => {
  test("shows the latest step still in progress", () => {
    const parts = [tool("a", "completed"), tool("b", "running"), text("t"), tool("c", "completed")]
    expect(tickerStep(parts)?.id).toBe("b")
  })

  test("shows the latest step when none is in progress", () => {
    expect(tickerStep([tool("a", "completed"), tool("b", "error")])?.id).toBe("b")
  })

  test("leaves subagents to their lanes", () => {
    expect(tickerStep([tool("a", "completed"), tool("s", "running", "acp_subagent")])?.id).toBe("a")
  })

  test("is empty without tool steps", () => {
    expect(tickerStep([text("t")])).toBeUndefined()
  })

  test("shows reasoning still streaming as the current step", () => {
    expect(tickerStep([tool("a", "completed"), reasoning("r")])?.id).toBe("r")
    expect(tickerStep([reasoning("r", 5), tool("a", "completed")])?.id).toBe("a")
    expect(tickerStep([reasoning("r"), tool("a", "running")])?.id).toBe("a")
  })
})

describe("toolDetail", () => {
  const done = (name: string, input: Record<string, unknown>, output: string) =>
    ({ id: "t", type: "tool", tool: name, state: { status: "completed", input, output } }) as unknown as ToolPart

  test("shows a command with its output, without terminal colours", () => {
    expect(toolDetail(done("bash", { command: "ls" }, "\u001b[32mREADME.md\u001b[0m\n"))).toBe("$ ls\n\nREADME.md")
  })

  test("shows the error of a failed call and nothing for a running one", () => {
    const failed = {
      id: "t",
      type: "tool",
      tool: "acp_other",
      state: { status: "error", input: {}, error: "MCP error -32001: Request timed out" },
    } as unknown as ToolPart
    expect(toolDetail(failed)).toBe("MCP error -32001: Request timed out")
    expect(toolDetail(tool("r", "running") as ToolPart)).toBeUndefined()
  })

  test("streams a running command's output from its metadata", () => {
    const running = {
      id: "t",
      type: "tool",
      tool: "bash",
      state: { status: "running", input: { command: "ls" }, metadata: { output: "a\nb" }, time: { start: 1 } },
    } as unknown as ToolPart
    expect(toolDetail(running)).toBe("$ ls\n\na\nb")
  })
})

describe("reasoningTopic", () => {
  test("takes the latest heading or bold title", () => {
    expect(
      reasoningTopic("**Reading the request**\n\nThe user wants...\n\n**Choosing a tool**\n\nask_user fits."),
    ).toBe("Choosing a tool")
    expect(reasoningTopic("## Plan\nsteps\n### Check `shape`\nmore")).toBe("Check shape")
  })

  test("falls back to the first sentence of the latest paragraph", () => {
    expect(reasoningTopic("First idea. More.\n\nThe user asks for five options. One question fits.")).toBe(
      "The user asks for five options.",
    )
    expect(reasoningTopic("  ")).toBeUndefined()
  })
})

describe("subagentLanes", () => {
  test("reads ACP steps and picks the step in progress as current", () => {
    const steps = [
      { tool: "acp_execute", title: "ls -la", status: "completed" },
      { tool: "acp_read", title: "/w/a.txt", status: "in_progress" },
      { tool: "acp_read", status: "completed" },
      { broken: true },
    ]
    const lanes = subagentLanes([
      tool("r", "completed"),
      tool("s", "running", "acp_subagent", { acpSteps: steps }),
      tool("t", "completed", "task"),
    ])
    expect(lanes.map((lane) => [lane.part.id, lane.running, lane.steps.length])).toEqual([
      ["s", true, 3],
      ["t", false, 0],
    ])
    expect(lanes[0]!.current).toEqual({ tool: "acp_read", title: "/w/a.txt", status: "in_progress" })
  })
})

describe("foldDuration", () => {
  test("grows with the card's height between 300 and 700 ms", () => {
    expect(foldDuration(60)).toBe(300)
    expect(foldDuration(400)).toBe(420)
    expect(foldDuration(2000)).toBe(700)
  })
})

describe("turnDuration", () => {
  test("runs from the user's message to the last assistant completion", () => {
    expect(turnDuration(1_000, [5_000, 24_000, undefined])).toBe(23_000)
  })

  test("is unknown until an assistant message completes, or without a start", () => {
    expect(turnDuration(1_000, [undefined])).toBeUndefined()
    expect(turnDuration(1_000, [])).toBeUndefined()
    expect(turnDuration(undefined, [5_000])).toBeUndefined()
    expect(turnDuration(10_000, [5_000])).toBeUndefined()
  })
})

describe("hasVisibleSteps", () => {
  const read = (part: { text?: string }) => part.text
  test("a tool step or reasoning with text shows; empty reasoning alone doesn't", () => {
    expect(hasVisibleSteps([tool("a", "completed")], read)).toBe(true)
    expect(hasVisibleSteps([reasoning("r", 2)], read)).toBe(true)
    const blank = { id: "r", type: "reasoning", text: "  ", time: { start: 1, end: 1 } } as unknown as Part
    expect(hasVisibleSteps([blank], read)).toBe(false)
    expect(hasVisibleSteps([], read)).toBe(false)
  })
})

describe("blockedNote", () => {
  const failed = (metadata?: Record<string, unknown>) =>
    ({
      id: "a",
      type: "tool",
      tool: "acp_execute",
      state: { status: "error", input: {}, error: "The user declined this tool call", metadata },
    }) as unknown as ToolPart

  test("names the rule-blocked action instead of calling the call declined", () => {
    const note = blockedNote(failed({ blocked: { reason: "rules", action: "bash" } }))
    expect(note).toEqual({ key: "secondBrain.turnSteps.blockedByRules", action: "bash" })
    expect(en[note!.key].replace("{{action}}", note!.action)).toBe("Blocked by permission rules: bash")
    expect(blockedNote(failed({ blocked: { reason: "error", action: "edit" } }))?.key).toBe(
      "secondBrain.turnSteps.blockedByError",
    )
  })

  test("leaves a call the user declined alone", () => {
    expect(blockedNote(failed())).toBeUndefined()
  })
})

describe("stepKeys", () => {
  test("keys each step by its part, so an earlier step that appears keeps the later ones on their rows", () => {
    expect(stepKeys([tool("shell", "running")])).toEqual(["shell"])
    expect(stepKeys([tool("question", "error"), tool("shell", "error")])).toEqual(["question", "shell"])
    expect(stepKeys([undefined, tool("shell", "completed")])).toEqual(["shell"])
  })
})

describe("assignRunKeys", () => {
  const read = (id: string) => tool(id, "completed", "read")

  test("a step arriving at the front of an open group keeps the group's key, so it stays open", () => {
    const first = assignRunKeys([[read("b"), read("c")]], new Map())
    expect(first.keys).toEqual(["b"])
    const grown = assignRunKeys([[read("a"), read("b"), read("c")]], first.byPart)
    expect(grown.keys).toEqual(first.keys)
  })

  test("a step that becomes a group keeps its row", () => {
    const single = assignRunKeys([[read("b")]], new Map())
    expect(assignRunKeys([[read("b"), read("c")]], single.byPart).keys).toEqual(single.keys)
  })

  test("a new run before others gets its own key and the others keep theirs", () => {
    const before = assignRunKeys([[tool("shell", "running", "bash")]], new Map())
    const after = assignRunKeys(
      [[tool("question", "error", "question")], [tool("shell", "error", "bash")]],
      before.byPart,
    )
    expect(after.keys).toEqual(["question", "shell"])
  })

  test("a group split in two gives each half a distinct key", () => {
    const whole = assignRunKeys([[read("a"), read("b"), read("c")]], new Map())
    const split = assignRunKeys([[read("a")], [tool("x", "completed", "bash")], [read("b"), read("c")]], whole.byPart)
    expect(split.keys[0]).toBe("a")
    expect(new Set(split.keys).size).toBe(3)
  })
})

describe("sameDiffs", () => {
  const edit = (additions: number, after = "export const value = 2\n") =>
    editDiffs({
      id: "prt_edit",
      type: "tool",
      tool: "edit",
      state: {
        status: "completed",
        input: { filePath: "src/a.ts" },
        output: "",
        title: "src/a.ts",
        metadata: {
          filediff: { file: "src/a.ts", additions, deletions: 1, before: "export const value = 1\n", after },
        },
        time: { start: 0, end: 1 },
      },
    } as unknown as ToolPart)

  test("treats a rebuilt but unchanged diff as the same, so its view is kept", () => {
    const first = edit(1)
    const again = edit(1)
    expect(again[0]).not.toBe(first[0])
    expect(sameDiffs(first, again)).toBe(true)
  })

  test("sees a changed count, while the file view underneath stays the same", () => {
    const first = edit(1)
    const counted = edit(2)
    expect(sameDiffs(first, counted)).toBe(false)
    expect(sameFileDiff(first[0].fileDiff, counted[0].fileDiff)).toBe(true)
  })

  test("sees changed content", () => {
    const first = edit(1)
    const changed = edit(1, "export const value = 3\n")
    expect(sameDiffs(first, changed)).toBe(false)
    expect(sameFileDiff(first[0].fileDiff, changed[0].fileDiff)).toBe(false)
  })
})
