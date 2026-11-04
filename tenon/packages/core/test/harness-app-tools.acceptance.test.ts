import { afterEach, describe, expect, test } from "bun:test"
import { HarnessAppTools } from "../src/harness/app-tools"
import { HarnessDelegation } from "../src/harness/delegation"

// P5 · App tools, AC-5.1: the `tenon` MCP server lists and routes installed app tools
// (implementations/notes-command-centre/implementation.md).

const caller = { sessionID: "ses_app_tools" }
const tool = {
  name: "notes_search",
  description: "Search notes",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
}
let uninstall: (() => void) | undefined

afterEach(() => {
  uninstall?.()
  uninstall = undefined
})

const list = async () => {
  const reply = (await HarnessDelegation.handleMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    caller,
    undefined,
  )) as {
    result: { tools: { name: string }[] }
  }
  return reply.result.tools.map((item) => item.name)
}

describe("HarnessAppTools", () => {
  test("AC-5.1 app tools are absent until installed", async () => {
    expect(await list()).not.toContain("notes_search")
  })

  test("AC-5.1 installed tools are listed per caller and calls are routed with the caller", async () => {
    const calls: unknown[] = []
    uninstall = HarnessAppTools.install({
      list: () => [tool],
      call: async (name, args, from) => {
        calls.push({ name, args, sessionID: from.sessionID })
        return { hits: 1 }
      },
    })
    expect(await list()).toContain("notes_search")
    const reply = (await HarnessDelegation.handleMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "notes_search", arguments: { query: "auth" } } },
      caller,
      undefined,
    )) as { result: { isError: boolean; content: { type: string; text: string }[] } }
    expect(reply.result.isError).toBe(false)
    expect(JSON.parse(reply.result.content[0].text)).toEqual({ hits: 1 })
    expect(calls).toEqual([{ name: "notes_search", args: { query: "auth" }, sessionID: "ses_app_tools" }])
  })

  test("AC-5.1 a failing tool returns isError with its message", async () => {
    uninstall = HarnessAppTools.install({
      list: () => [tool],
      call: async () => {
        throw new Error("outside this Project")
      },
    })
    const reply = (await HarnessDelegation.handleMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "notes_search", arguments: {} } },
      caller,
      undefined,
    )) as { result: { isError: boolean; content: { text: string }[] } }
    expect(reply.result.isError).toBe(true)
    expect(reply.result.content[0].text).toContain("outside this Project")
  })

  test("AC-5.1 uninstalling removes the tools", async () => {
    const remove = HarnessAppTools.install({ list: () => [tool], call: async () => ({}) })
    remove()
    expect(await list()).not.toContain("notes_search")
  })
})
