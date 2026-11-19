import { describe, expect, test } from "bun:test"
import type { Harness } from "@tenon/schema/harness"
import { harnessStatusKey } from "./harness-controls"
import { shouldCheckHarnessUpdates } from "./harness-update-choice"

const instance = (input: Partial<Harness.Instance>) =>
  ({
    id: "gemini",
    name: "Gemini",
    driver: "acp",
    status: "available",
    models: [],
    ...input,
  }) as unknown as Harness.Instance

describe("AC-13 the picker keeps a slow harness selectable", () => {
  test("a slow-to-start harness says so instead of Unavailable", () => {
    expect(harnessStatusKey(instance({ slowStart: true }))).toBe("harness.slowStart")
  })

  test("a slow start also asks whether an update is out", () => {
    expect(shouldCheckHarnessUpdates([instance({ slowStart: true })], undefined, 10_000)).toBe(true)
  })
})
