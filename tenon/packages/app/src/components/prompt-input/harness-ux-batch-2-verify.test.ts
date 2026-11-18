import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { Harness } from "@tenon/schema/harness"
import { getSessionContext } from "@/components/session/session-context-metrics"
import { scheduleBounds } from "@/features/second-brain/calendar-domain"
import { asksUser, finishMark } from "@/features/second-brain/thread-finish"
import { dictationLanguage } from "./dictation-language"
import { harnessModelFor, withRememberedModels } from "./harness-memory"
import { createHarnessSwitchQueue } from "./harness-switch"

// Verification tests for implementations/harness-ux-batch-2: edge cases beyond the acceptance criteria.

const instance = (id: string, models: string[], status: "available" | "unavailable" = "available") =>
  ({
    id: Harness.InstanceID.make(id),
    driver: Harness.AcpDriver,
    name: id,
    status,
    models: models.map((model) => ({ id: model, name: model, reasoningEfforts: [], serviceTiers: [] })),
  }) as unknown as Harness.Instance

describe("verify withRememberedModels", () => {
  test("an unavailable harness is not given remembered models", () => {
    const out = withRememberedModels([instance("claude", [], "unavailable")], [instance("claude", ["opus"])])
    expect(out?.[0]?.models).toEqual([])
  })

  test("a harness that was never remembered keeps its empty list, others are filled", () => {
    const out = withRememberedModels([instance("claude", []), instance("codex", [])], [instance("codex", ["gpt-5.5"])])
    expect(out?.map((item) => item.models.length)).toEqual([0, 1])
  })

  test("the built-in loop is untouched", () => {
    const builtIn = { ...instance(Harness.OpenCode, []), driver: Harness.OpenCodeDriver } as Harness.Instance
    const out = withRememberedModels([builtIn], [{ ...builtIn, models: instance("x", ["m"]).models }])
    expect(out?.[0]?.models).toEqual([])
  })
})

describe("verify harnessModelFor", () => {
  test("the built-in loop has no harness model", () => {
    const builtIn = { ...instance(Harness.OpenCode, ["a"]), driver: Harness.OpenCodeDriver } as Harness.Instance
    expect(harnessModelFor(builtIn, { id: "a" })).toBeUndefined()
  })

  test("a harness whose models are not listed yet keeps the remembered model", () => {
    expect(harnessModelFor(instance("codex", []), { id: "gpt-5.6", reasoningEffort: "low" })).toEqual({
      id: "gpt-5.6",
      reasoningEffort: "low",
    })
  })
})

describe("verify createHarnessSwitchQueue", () => {
  test("a failed send still settles, clears the pick and reports the error", async () => {
    const errors: unknown[] = []
    const queue = createHarnessSwitchQueue<string>({
      send: async () => {
        throw new Error("offline")
      },
      onError: (error) => errors.push(error),
    })
    queue.switch("codex")
    await queue.settled()
    expect(queue.pending()).toBeUndefined()
    expect(errors).toHaveLength(1)
  })

  // Added after the panel review: a send waiting on a failed switch must not go to the old harness.
  test("settled says whether the last pick reached the server", async () => {
    const failing = createHarnessSwitchQueue<string>({
      send: async () => {
        throw new Error("offline")
      },
    })
    failing.switch("codex")
    expect(await failing.settled()).toBe(false)
    const working = createHarnessSwitchQueue<string>({ send: async () => {} })
    working.switch("codex")
    expect(await working.settled()).toBe(true)
    expect(await working.settled()).toBe(true)
  })

  test("picks made while one is sending collapse to the last", async () => {
    const sent: string[] = []
    let release = () => {}
    const queue = createHarnessSwitchQueue<string>({
      send: (choice) => {
        sent.push(choice)
        return sent.length === 1 ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve()
      },
    })
    queue.switch("a")
    queue.switch("b")
    queue.switch("c")
    release()
    await queue.settled()
    expect(sent).toEqual(["a", "c"])
  })
})

describe("verify asksUser", () => {
  test("a question inside a trailing code block is not a question to the user", () => {
    expect(asksUser("Here is the check:\n\n```ts\nconst ok = a?.b ?? c ?\n```")).toBe(false)
  })

  test("emphasis around the last question still counts", () => {
    expect(asksUser("Two ways to go.\n\n**Shall I proceed with the first?**")).toBe(true)
  })

  test("a question earlier, then a statement, does not count", () => {
    expect(asksUser("Why did it fail? The cache was stale. It is fixed now.")).toBe(false)
  })

  test("a full-width question mark counts", () => {
    expect(asksUser("要继续吗？")).toBe(true)
  })
})

describe("verify finishMark", () => {
  test("an error wins even without asks", () => {
    expect(finishMark({ unseen: 1, error: true, asks: false })).toBe("failed")
  })
})

describe("verify dictationLanguage", () => {
  test("a region in the app locale is dropped", () => {
    expect(dictationLanguage("app", "pt-BR")).toBe("pt")
  })
})

describe("verify scheduleBounds", () => {
  test("the agenda ignores the cursor", () => {
    const week = { start: "2026-01-05", end: "2026-01-11" }
    expect(scheduleBounds("agenda", "2027-03-01", week, "2026-11-18").start).toBe("2026-11-18")
  })
})

describe("verify running context fallback", () => {
  const assistant = (id: string, harness: string | undefined, contextUsed?: number) =>
    ({
      id,
      role: "assistant",
      providerID: "p",
      modelID: "m",
      harnessInstanceID: harness,
      contextUsed,
      contextWindow: contextUsed ? 100_000 : undefined,
      cost: 0,
      tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1 },
    }) as unknown as Message

  test("a report from another harness is not used", () => {
    const context = getSessionContext([assistant("a1", "claude-code", 40_000), assistant("a2", "opencode-acp")], [])
    expect(context?.reported).toBe(false)
  })

  // Added after the panel review: a report from before a compaction is not the context after it.
  test("a report from before a compaction is not reused", () => {
    const messages = [
      assistant("msg_a1", "opencode-acp", 190_000),
      { id: "msg_u2", role: "user", time: { created: 2 } } as unknown as Message,
      assistant("msg_a3", "opencode-acp"),
    ]
    const parts = (id: string) =>
      id === "msg_u2"
        ? ([{ id: "msg_c2:compaction", messageID: "msg_u2", type: "compaction" }] as never)
        : ([] as never)
    const context = getSessionContext(messages, [], undefined, parts)
    expect(context?.reported).toBe(false)
  })

  test("the newest report of the same harness wins", () => {
    const context = getSessionContext(
      [
        assistant("a1", "opencode-acp", 10_000),
        assistant("a2", "opencode-acp", 20_000),
        assistant("a3", "opencode-acp"),
      ],
      [],
    )
    expect(context?.total).toBe(20_000)
  })
})
