import { describe, expect, test } from "bun:test"
import { HarnessComputerProxy } from "@tenon/core/harness/computer-proxy"

// #333 follow-ups: every Cua Driver call passes through Tenon. Reading the screen never asks; the first click or
// keystroke in a thread asks once (2A); a Project switched off refuses the next action (3A); Stop shuts the driver
// down at once and forgets the thread grants (3B).
const tools = [
  { name: "screenshot", description: "", inputSchema: {}, annotations: { readOnlyHint: true } },
  { name: "list_apps", description: "", inputSchema: {} },
  { name: "click", description: "", inputSchema: {} },
  { name: "type_text", description: "", inputSchema: {} },
]

function setup(input: { enabled?: boolean; answer?: "thread" | "once" | "deny" } = {}) {
  const calls: string[] = []
  const shown: string[] = []
  const asked: string[] = []
  let stopped = 0
  const state = { enabled: input.enabled ?? true }
  const proxy = HarnessComputerProxy.make({
    driver: {
      tools: async () => tools,
      call: async (name) => {
        calls.push(name)
        return { content: [{ type: "text", text: `${name} done` }] }
      },
      stop: () => void stopped++,
    },
    enabled: async () => state.enabled,
    indicator: (event) => void shown.push(`${event.harness}:${event.active}`),
  })
  const ask = async (question: string) => {
    asked.push(question)
    return input.answer ?? "thread"
  }
  return { proxy, calls, shown, asked, state, ask, stopped: () => stopped }
}

const caller = { sessionID: "s1", directory: "/p", harness: "Gemini" }

describe("AC-23 reading the screen never asks", () => {
  test("a read-only tool, or one named like a read, runs without a question", async () => {
    const { proxy, calls, asked, ask } = setup()
    await proxy.call("screenshot", {}, caller, ask)
    await proxy.call("list_apps", {}, caller, ask)
    expect(calls).toEqual(["screenshot", "list_apps"])
    expect(asked).toHaveLength(0)
  })
})

describe("AC-23 the first action in a thread asks once", () => {
  test("Allow for this thread covers its later actions; another thread asks again", async () => {
    const { proxy, calls, asked, ask } = setup({ answer: "thread" })
    await proxy.call("click", {}, caller, ask)
    await proxy.call("type_text", {}, caller, ask)
    expect(asked).toHaveLength(1)
    expect(calls).toEqual(["click", "type_text"])
    await proxy.call("click", {}, { ...caller, sessionID: "s2" }, ask)
    expect(asked).toHaveLength(2)
  })

  test("Just this once asks again next time; Don't allow refuses and runs nothing", async () => {
    const once = setup({ answer: "once" })
    await once.proxy.call("click", {}, caller, once.ask)
    await once.proxy.call("click", {}, caller, once.ask)
    expect(once.asked).toHaveLength(2)
    const deny = setup({ answer: "deny" })
    const result = await deny.proxy.call("click", {}, caller, deny.ask)
    expect(result.isError).toBe(true)
    expect(deny.calls).toHaveLength(0)
  })

  test("each action lights the on-screen indicator with the harness's name", async () => {
    const { proxy, shown, ask } = setup()
    await proxy.call("click", {}, caller, ask)
    expect(shown).toContain("Gemini:true")
  })
})

describe("AC-23 switching off and Stop", () => {
  test("a Project switched off refuses the next action, saying why", async () => {
    const { proxy, calls, state, ask } = setup()
    await proxy.call("click", {}, caller, ask)
    state.enabled = false
    const result = await proxy.call("click", {}, caller, ask)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("turned off")
    expect(calls).toEqual(["click"])
  })

  test("Stop shuts the driver down and forgets every thread's grant", async () => {
    const { proxy, asked, ask, stopped } = setup()
    await proxy.call("click", {}, caller, ask)
    proxy.stop()
    expect(stopped()).toBe(1)
    // The thread used the desktop moments ago, so its next action first hears that Stop was pressed (C2-6)…
    const told = await proxy.call("click", {}, caller, ask)
    expect(JSON.stringify(told.content)).toContain("pressed Stop")
    // …and the one after asks again: the grant is gone.
    await proxy.call("click", {}, caller, ask)
    expect(asked).toHaveLength(2)
  })

  test("Stop tells the Project how many of its threads it ended, and each of them is told once", async () => {
    const { proxy, ask } = setup()
    await proxy.call("click", {}, caller, ask)
    await proxy.call("click", {}, { sessionID: "s2", directory: "/p/sub", harness: "OpenCode" }, ask)
    await proxy.call("click", {}, { sessionID: "s3", directory: "/other", harness: "Gemini" }, ask)
    proxy.stop()
    expect(proxy.stoppedIn("/p")).toBe(2)
    expect(proxy.stoppedIn("/other")).toBe(1)
    const next = await proxy.call("click", {}, caller, ask)
    expect(JSON.stringify(next.content)).toContain("pressed Stop")
  })

  test("the tool list is empty when the Project has it off", async () => {
    const { proxy, state } = setup()
    expect((await proxy.tools(caller)).map((tool) => tool.name)).toEqual([
      "screenshot",
      "list_apps",
      "click",
      "type_text",
    ])
    state.enabled = false
    expect(await proxy.tools(caller)).toEqual([])
  })
})
