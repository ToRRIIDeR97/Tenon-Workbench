import { describe, expect, test } from "bun:test"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { isDeclined, isStopped, stepOf, subagentName, summarizeTurn } from "./step-kind"

const tool = (name: string, input: Record<string, unknown>, status = "completed") =>
  ({
    id: `prt_${name}`,
    sessionID: "ses",
    messageID: "msg",
    type: "tool",
    callID: "call",
    tool: name,
    state: { status, input, output: "", title: "", metadata: {}, time: { start: 0, end: 1 } },
  }) as unknown as ToolPart

describe("stepOf", () => {
  test("Codex and ACP names share kinds with built-in tools", () => {
    expect(stepOf(tool("command_execution", { command: "git status" }))).toEqual({ kind: "run", target: "git status" })
    expect(stepOf(tool("acp_execute", { command: ["ls", "-la"] }))).toEqual({ kind: "run", target: "ls -la" })
    expect(stepOf(tool("bash", { command: "bun test" }))).toEqual({ kind: "run", target: "bun test" })
  })

  test("MCP tools need a configured server prefix", () => {
    expect(stepOf(tool("github_get_issue", {}), { mcpServers: ["github"] })).toEqual({
      kind: "mcp",
      target: "github · get_issue",
    })
    expect(stepOf(tool("github_get_issue", {})).kind).toBe("other")
  })
})

describe("stepOf for ACP tools without a kind", () => {
  test("a call with questions is a question, targeted at the first one", () => {
    const input = { title: "tenon_ask_user", questions: [{ question: "Which database?", header: "DB", options: [] }] }
    expect(stepOf(tool("acp_other", input))).toEqual({ kind: "question", target: "Which database?" })
  })

  test("other calls are named by the agent's title", () => {
    expect(stepOf(tool("acp_other", { title: "tenon_list_agents" }))).toEqual({
      kind: "other",
      target: "tenon_list_agents",
    })
    expect(stepOf(tool("unknown_tool", {}))).toEqual({ kind: "other", target: "unknown_tool" })
  })
})

describe("summarizeTurn", () => {
  test("counts tool parts only", () => {
    const text = { id: "t", type: "text", text: "hi" } as unknown as Part
    expect(summarizeTurn([text, tool("read", { filePath: "a" }), tool("bash", {}, "error")])).toEqual({
      counts: { read: 1, run: 1 },
      failed: 1,
      declined: 0,
      running: 0,
    })
  })

  test("counts a declined permission apart from failures", () => {
    const parts = [
      errored("acp_execute", "The user declined this tool call"),
      errored("bash", "The user rejected permission to use this specific tool call."),
      errored("bash", "exit code 1"),
    ]
    expect(parts.map(isDeclined)).toEqual([true, true, false])
    expect(summarizeTurn(parts)).toEqual({ counts: { run: 3 }, failed: 1, declined: 2, running: 0 })
  })

  test("does not count a call cut short by Stop as failed", () => {
    const parts = [errored("bash", "Tool execution interrupted"), errored("bash", "exit code 1")]
    expect(parts.map(isStopped)).toEqual([true, false])
    expect(summarizeTurn(parts)).toEqual({ counts: { run: 2 }, failed: 1, declined: 0, running: 0 })
  })
})

const errored = (name: string, error: string) =>
  ({
    ...tool(name, {}),
    state: { status: "error", input: {}, error, time: { start: 0, end: 1 } },
  }) as unknown as ToolPart

describe("subagentName", () => {
  test("names a subagent by its task and tags it with its type", () => {
    expect(subagentName({ description: "  Map the auth flow (@explore subagent) ", subagent_type: "explore" })).toEqual(
      {
        name: "Map the auth flow",
        tag: "explore",
      },
    )
  })

  test("leaves the name empty when there is no description", () => {
    expect(subagentName({ subagent_type: "general" })).toEqual({ name: undefined, tag: "general" })
    expect(subagentName(undefined)).toEqual({ name: undefined, tag: undefined })
  })
})
