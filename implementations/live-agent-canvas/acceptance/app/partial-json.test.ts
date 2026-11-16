import { describe, expect, test } from "bun:test"
import { parsePartialJson } from "../../../../tenon/packages/app/src/utils/partial-json"
import { normalizeSessionMessages } from "../../../../tenon/packages/app/src/utils/session-message"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"

// AC-1: a tool's half-written JSON input heals into the fields seen so far.
describe("AC-1 parsePartialJson", () => {
  test.each([
    ['{"path":"docs/a.md","content":"# Ti', { path: "docs/a.md", content: "# Ti" }],
    ['{"path":"a.html","content":"<div class=\\"x', { path: "a.html", content: '<div class="x' }],
    ['{"a":1,"b"', { a: 1 }],
    ['{"a":1,"b":', { a: 1 }],
    ['{"a":[1,2,{"c":"d', { a: [1, 2, { c: "d" }] }],
    ['{"a":true,"b":nu', { a: true }],
    ['{"done":"yes"}', { done: "yes" }],
    ['{"text":"line\\', { text: "line" }],
    ['{"text":"caf\\u00e', { text: "caf" }],
  ])("%s", (raw, expected) => {
    expect(parsePartialJson(raw)).toEqual(expected)
  })

  test("nothing usable is undefined", () => {
    expect(parsePartialJson("")).toBeUndefined()
    expect(parsePartialJson("   ")).toBeUndefined()
    expect(parsePartialJson("not json")).toBeUndefined()
  })
})

// AC-2: streaming write/edit tool parts expose their fields before the input is complete.
describe("AC-2 streaming tool input in session parts", () => {
  const part = (name: string, raw: string) =>
    normalizeSessionMessages("ses_1", [
      { id: "msg_1", type: "user", text: "hi", time: { created: 1 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "tool", id: "call_1", name, state: { status: "streaming", input: raw }, time: { created: 2 } }],
        time: { created: 2 },
      },
    ] as SessionMessageInfo[]).parts.get("msg_2")?.[0] as { state: { status: string; input: Record<string, unknown>; raw?: string } }

  test("write: path becomes filePath and content grows", () => {
    const raw = '{"path":"docs/plan.md","content":"# Plan\\n\\nFirst'
    const state = part("write", raw).state
    expect(state.status).toBe("pending")
    expect(state.input.filePath).toBe("docs/plan.md")
    expect(state.input.content).toBe("# Plan\n\nFirst")
    expect(state.raw).toBe(raw)
  })

  test("edit: oldString and a partial newString", () => {
    const state = part("edit", '{"path":"a.md","oldString":"one","newString":"tw').state
    expect(state.input).toMatchObject({ filePath: "a.md", oldString: "one", newString: "tw" })
  })
})
