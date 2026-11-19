import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Harness } from "@tenon/schema/harness"
import { harnessUpdateChoice, shouldCheckHarnessUpdates } from "./harness-update-choice"

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

describe("AC-2 an unavailable harness offers its update where it fails", () => {
  test("an unavailable harness with an update can be updated from the picker", () => {
    expect(
      harnessUpdateChoice(instance({ status: "unavailable", error: "handshake failed" }), update(), false),
    ).toEqual({ kind: "update", latest: "0.52.0", disabled: false })
  })

  test("while it updates the row says so and can't be picked", () => {
    expect(harnessUpdateChoice(instance({ status: "unavailable" }), update(), true)).toEqual({
      kind: "updating",
      disabled: true,
    })
  })

  test("an unavailable harness with no update shows its own error, first line only", () => {
    expect(
      harnessUpdateChoice(
        instance({ status: "unavailable", error: "spawn codex ENOENT\n    at stack" }),
        undefined,
        false,
      ),
    ).toEqual({ kind: "unavailable", error: "spawn codex ENOENT", disabled: true })
  })

  test("an update that must be installed by hand isn't offered as a button", () => {
    expect(harnessUpdateChoice(instance({ status: "unavailable" }), update({ method: undefined }), false)).toEqual({
      kind: "unavailable",
      error: undefined,
      disabled: true,
    })
  })

  test("an available harness is left as it is", () => {
    expect(harnessUpdateChoice(instance(), update(), false)).toBeUndefined()
  })
})

describe("AC-2 a harness that becomes unavailable triggers a fresh update check", () => {
  test("checks when an enabled harness is unavailable and the last check is over a minute old", () => {
    const list = [instance(), instance({ id: "gemini" as never, status: "unavailable" })]
    expect(shouldCheckHarnessUpdates(list, undefined, 10_000)).toBe(true)
    expect(shouldCheckHarnessUpdates(list, 0, 61_000)).toBe(true)
    expect(shouldCheckHarnessUpdates(list, 30_000, 61_000)).toBe(false)
  })

  // The list only carries enabled harnesses (core `list()` filters them), so a disabled one never asks.
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
