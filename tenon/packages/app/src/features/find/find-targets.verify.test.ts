import { describe, expect, test } from "bun:test"
import { pickFindTarget, type FindTargetInfo } from "./find-targets"

const target = (id: string, layer: number, contains: (node: unknown) => boolean = () => false, enabled = true) =>
  ({ id, layer, contains, enabled: () => enabled }) satisfies FindTargetInfo

describe("AC-4 pickFindTarget (verification)", () => {
  test("a disabled target is skipped even when it holds focus", () => {
    const thread = target("thread", 0, () => true, false)
    expect(pickFindTarget([thread, target("page", 0)], "x")?.id).toBe("page")
  })

  test("among equal layers the most recently registered target wins", () => {
    expect(pickFindTarget([target("page", 0), target("thread", 0)], undefined)?.id).toBe("thread")
  })

  test("focus inside a lower-layer target beats a higher layer", () => {
    const panel = target("documents", 1, (node) => node === "doc")
    expect(pickFindTarget([panel, target("settings", 10)], "doc")?.id).toBe("documents")
  })

  test("when several targets hold focus the highest layer wins", () => {
    const page = target("page", 0, () => true)
    const docs = target("documents", 1, () => true)
    expect(pickFindTarget([docs, page], "x")?.id).toBe("documents")
  })
})
