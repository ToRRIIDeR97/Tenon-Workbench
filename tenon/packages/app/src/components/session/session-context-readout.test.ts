import { describe, expect, test } from "bun:test"
import { contextReadout } from "./session-context-metrics"

// #310: the ring, the context menu and the Context tab read one readout, so they can't disagree.
const base = { total: 50_000, limit: 200_000 as number | undefined, usage: 25 as number | null, reported: true, compacted: false }

describe("contextReadout", () => {
  test("AC-1 unreported context with a known window shows tokens only, never a share", () => {
    expect(contextReadout({ ...base, reported: false, usage: null })).toEqual({ kind: "unreported", tokens: 50_000 })
  })

  test("AC-2 a reported context without a window shows tokens, no share", () => {
    expect(contextReadout({ ...base, limit: undefined, usage: null })).toEqual({ kind: "tokens", tokens: 50_000 })
  })

  test("AC-3 a reported context with a window shows its share", () => {
    expect(contextReadout(base)).toEqual({ kind: "share", tokens: 50_000, limit: 200_000, percent: 25 })
  })

  test("AC-3 a compacted context stays compacted, whatever the numbers say", () => {
    expect(contextReadout({ ...base, compacted: true })).toEqual({ kind: "compacted" })
  })

  test("no context at all reads as none", () => {
    expect(contextReadout(undefined)).toEqual({ kind: "none" })
    expect(contextReadout({ ...base, total: 0, reported: false, usage: null })).toEqual({ kind: "none" })
  })
})
