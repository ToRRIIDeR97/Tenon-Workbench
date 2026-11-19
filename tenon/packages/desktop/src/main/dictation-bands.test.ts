import { describe, expect, test } from "bun:test"
import { dictationBands } from "./dictation"

// #328: the engine's frequency bands reach the renderer as plain numbers between 0 and 1.
describe("AC-16 the engine's band events", () => {
  test("a bands event becomes its values, clamped", () => {
    expect(dictationBands({ type: "bands", values: [0, 0.5, 1.4, -0.2] })).toEqual([0, 0.5, 1, 0])
  })

  test("anything else is not a bands event", () => {
    expect(dictationBands({ type: "level", rms: 0.2 })).toBeUndefined()
    expect(dictationBands({ type: "bands", values: "x" })).toBeUndefined()
    expect(dictationBands({ type: "bands", values: [1, "a"] })).toBeUndefined()
    expect(dictationBands({ type: "bands", values: new Array(200).fill(0.5) })).toBeUndefined()
  })
})
