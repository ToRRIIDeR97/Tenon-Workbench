import { describe, expect, test } from "bun:test"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { foldDuration, reasoningTopic, subagentLanes, tickerStep, toolDetail } from "./turn-steps-summary"

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
