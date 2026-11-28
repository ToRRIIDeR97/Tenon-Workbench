import { describe, expect, test } from "bun:test"
import { pickFindTarget, type FindTargetInfo } from "./find-targets"

const target = (id: string, layer: number, contains: (node: unknown) => boolean = () => false, enabled = true) =>
  ({ id, layer, contains, enabled: () => enabled }) satisfies FindTargetInfo

describe("AC-4 pickFindTarget", () => {
  test("the target holding the focused element wins", () => {
    const terminal = target("terminal", 0, (node) => node === "terminal-canvas")
    const page = target("page", 0)
    const settings = target("settings", 10)
    expect(pickFindTarget([page, settings, terminal], "terminal-canvas")?.id).toBe("terminal")
  })

  test("without focus inside a target, the highest layer wins", () => {
    expect(pickFindTarget([target("page", 0), target("settings", 10)], undefined)?.id).toBe("settings")
  })

  test("disabled targets are skipped", () => {
    expect(pickFindTarget([target("page", 0), target("settings", 10, () => false, false)], undefined)?.id).toBe("page")
  })

  test("no targets, no pick", () => {
    expect(pickFindTarget([], undefined)).toBeUndefined()
  })
})
