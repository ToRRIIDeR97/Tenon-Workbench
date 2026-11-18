import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { Harness } from "@tenon/schema/harness"
import { getSessionContext } from "@/components/session/session-context-metrics"
import { listHarnessesRemembered } from "@/utils/server"
import { createRememberedModelWindow, REMEMBERED_MODELS_MS, withRememberedModels } from "./harness-memory"

// Verification tests for implementations/harness-ux-batch-2, panel round 3: remembered models expire, harness checks
// are shared and reused, and a context figure above a model-derived window is not shown.

const instance = (id: string, models: string[]) =>
  ({
    id: Harness.InstanceID.make(id),
    driver: Harness.AcpDriver,
    name: id,
    status: "available",
    models: models.map((model) => ({
      id: model,
      name: model,
      reasoningEfforts: [],
      serviceTiers: [],
      isDefault: false,
    })),
  }) as unknown as Harness.Instance

describe("remembered models expire", () => {
  test("an agent that keeps answering with no models loses its remembered ones after a minute", () => {
    let clock = 0
    const window = createRememberedModelWindow(() => clock)
    const remembered = [instance("claude", ["opus"])]
    window.observe([instance("claude", [])])
    expect(withRememberedModels([instance("claude", [])], remembered, window.fill)?.[0]?.models).toHaveLength(1)
    clock = REMEMBERED_MODELS_MS + 1
    window.observe([instance("claude", [])])
    expect(withRememberedModels([instance("claude", [])], remembered, window.fill)?.[0]?.models).toHaveLength(0)
  })

  test("listing models again resets the minute", () => {
    let clock = 0
    const window = createRememberedModelWindow(() => clock)
    window.observe([instance("claude", [])])
    clock = REMEMBERED_MODELS_MS + 1
    window.observe([instance("claude", ["opus"])])
    window.observe([instance("claude", [])])
    expect(window.fill(Harness.InstanceID.make("claude"))).toBe(true)
  })
})

describe("harness checks are shared and reused", () => {
  const server = { url: "http://check-sharing.test", username: "", password: "" }
  const answer = () =>
    Response.json({
      location: { directory: "/w", project: { id: "p", directory: "/w" } },
      data: [{ id: "opencode", driver: "opencode", name: "OpenCode", status: "available", models: [] }],
    })

  test("pages opening at once share one check, a recent check is reused, and a forced check asks again", async () => {
    let requests = 0
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const fetch = (async () => {
      requests++
      await gate
      return answer()
    }) as unknown as typeof globalThis.fetch
    const input = { server, fetch }
    const first = listHarnessesRemembered(input, "/w", undefined, { reuse: true })
    const second = listHarnessesRemembered(input, "/w", undefined, { reuse: true })
    release()
    await Promise.all([first, second])
    expect(requests).toBe(1)

    await listHarnessesRemembered(input, "/w", undefined, { reuse: true })
    expect(requests).toBe(1)

    await listHarnessesRemembered(input, "/w", undefined, { reuse: false })
    expect(requests).toBe(2)
  })
})

describe("context above a model-derived window", () => {
  test("a harness that sends no window and reports more than its model's window shows Not reported", () => {
    const message = {
      id: "a1",
      role: "assistant",
      providerID: "opencode",
      modelID: "small-window",
      harnessInstanceID: "opencode-acp",
      contextUsed: 250_000,
      cost: 0,
      tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1 },
    } as unknown as Message
    const providers = [{ id: "opencode", models: { "small-window": { limit: { context: 200_000 } } } }]
    const context = getSessionContext([message], providers)
    expect(context?.limit).toBe(200_000)
    expect(context?.reported).toBe(false)
    expect(context?.usage).toBeNull()
  })
})
