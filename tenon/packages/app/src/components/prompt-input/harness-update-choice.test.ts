import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Harness } from "@tenon/schema/harness"
import { harnessUpdateChoice, harnessUpdateOffer, shouldCheckHarnessUpdates } from "./harness-update-choice"

const instance = (input: Partial<Harness.Instance> = {}) =>
  ({
    id: "codex",
    name: "Codex",
    driver: "acp",
    status: "available",
    models: [],
    ...input,
  }) as unknown as Harness.Instance

const update = (input: Partial<Harness.UpdateStatus> = {}) =>
  ({
    id: "codex",
    name: "Codex",
    version: "0.40.0",
    latest: "0.52.0",
    updateAvailable: true,
    method: "npm",
    ...input,
  }) as unknown as Harness.UpdateStatus

describe("a harness runs on the version that is installed; updating is an extra choice", () => {
  test("an unavailable harness shows its own error, first line only, and is never turned into an update button", () => {
    expect(
      harnessUpdateChoice(instance({ status: "unavailable", error: "spawn codex ENOENT\n    at stack" }), false),
    ).toEqual({ kind: "unavailable", error: "spawn codex ENOENT", disabled: true })
  })

  test("while it updates the row says so and can't be picked", () => {
    expect(harnessUpdateChoice(instance({ status: "unavailable" }), true)).toEqual({
      kind: "updating",
      disabled: true,
    })
  })

  test("an available harness stays selectable even when a newer version exists", () => {
    expect(harnessUpdateChoice(instance(), false)).toBeUndefined()
    expect(harnessUpdateOffer(update(), false)).toEqual({ latest: "0.52.0" })
  })

  test("the update is offered only when Tenon can run it", () => {
    expect(harnessUpdateOffer(update({ method: undefined }), false)).toBeUndefined()
    expect(harnessUpdateOffer(update({ manual: true }), false)).toBeUndefined()
    expect(harnessUpdateOffer(update({ updateAvailable: false }), false)).toBeUndefined()
    expect(harnessUpdateOffer(update(), true)).toBeUndefined()
    expect(harnessUpdateOffer(undefined, false)).toBeUndefined()
  })
})

describe("AC-2 a harness that becomes unavailable triggers a fresh update check", () => {
  test("checks when an enabled harness is unavailable and the last check is over a minute old", () => {
    const list = [instance(), instance({ id: "gemini" as never, status: "unavailable" })]
    expect(shouldCheckHarnessUpdates(list, undefined, 10_000)).toBe(true)
    expect(shouldCheckHarnessUpdates(list, 0, 61_000)).toBe(true)
    expect(shouldCheckHarnessUpdates(list, 30_000, 61_000)).toBe(false)
  })

  test("doesn't check when every harness is available", () => {
    expect(shouldCheckHarnessUpdates([instance()], undefined, 10_000)).toBe(false)
    expect(shouldCheckHarnessUpdates(undefined, undefined, 10_000)).toBe(false)
  })

  test("the model pill's harness rows use the choice and can start the update", () => {
    const source = readFileSync(join(import.meta.dir, "model-pill.tsx"), "utf8")
    expect(source).toContain("harnessUpdateChoice(")
    expect(source).toMatch(/update\?\.run\(/)
  })
})
