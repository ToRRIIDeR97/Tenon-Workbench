import { describe, expect, test } from "bun:test"
import { Harness } from "@tenon/schema/harness"
import { harnessModelFor, harnessRetryDelay, withRememberedModels } from "./harness-memory"

const model = (id: string, extra: Partial<Harness.Model> = {}): Harness.Model => ({
  id,
  name: id,
  reasoningEfforts: [],
  serviceTiers: [],
  isDefault: false,
  ...extra,
})

const instance = (id: string, models: Harness.Model[], status: "available" | "unavailable" = "available") =>
  ({
    id: Harness.InstanceID.make(id),
    driver: Harness.AcpDriver,
    name: id,
    status,
    models,
  }) as Harness.Instance

describe("AC-1 harnessRetryDelay", () => {
  test("retries quickly at first, then every 15 seconds, and never gives up", () => {
    expect(harnessRetryDelay(0)).toBe(3_000)
    expect(harnessRetryDelay(9)).toBe(3_000)
    expect(harnessRetryDelay(10)).toBe(15_000)
    expect(harnessRetryDelay(500)).toBe(15_000)
  })
})

describe("AC-2 withRememberedModels", () => {
  test("an available harness that lists no models yet shows the models it had last time", () => {
    const fresh = [instance("claude", [])]
    const remembered = [instance("claude", [model("opus"), model("sonnet")])]
    expect(withRememberedModels(fresh, remembered)?.[0]?.models.map((item) => item.id)).toEqual(["opus", "sonnet"])
  })

  test("a harness that lists models keeps its own list", () => {
    const fresh = [instance("claude", [model("fable")])]
    const remembered = [instance("claude", [model("opus")])]
    expect(withRememberedModels(fresh, remembered)?.[0]?.models.map((item) => item.id)).toEqual(["fable"])
  })

  test("nothing remembered leaves the list as it is", () => {
    const fresh = [instance("claude", [])]
    expect(withRememberedModels(fresh, undefined)).toBe(fresh)
  })
})

describe("AC-2 harnessModelFor", () => {
  test("picks the model last used with the harness when it is still listed", () => {
    const target = instance("codex", [model("gpt-5.5", { isDefault: true }), model("gpt-5.6")])
    expect(harnessModelFor(target, { id: "gpt-5.6", reasoningEffort: "high", serviceTier: "fast" })).toEqual({
      id: "gpt-5.6",
      reasoningEffort: "high",
      serviceTier: "fast",
    })
  })

  test("falls back to the harness default when the last model is gone or unknown", () => {
    const target = instance("codex", [model("gpt-5.5", { isDefault: true }), model("gpt-5.6")])
    expect(harnessModelFor(target, { id: "retired" })?.id).toBe("gpt-5.5")
    expect(harnessModelFor(target, undefined)?.id).toBe("gpt-5.5")
  })
})
