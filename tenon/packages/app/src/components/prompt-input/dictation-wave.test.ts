import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { waveBars } from "./dictation-wave"

// #328 (variant A): a wave whose bars follow the microphone's frequency bands, inside the composer.
describe("AC-16 the voice wave", () => {
  test("bars rise at once to a louder band and fall back slowly", () => {
    const up = waveBars([1, 1, 1, 1], [0, 0, 0, 0], 4)
    expect(up).toEqual([1, 1, 1, 1])
    const down = waveBars([0, 0, 0, 0], up, 4)
    expect(down.every((value) => value < 1 && value > 0.5)).toBe(true)
  })

  test("the engine's bands are spread over as many bars as the wave has", () => {
    expect(waveBars([0, 1], [], 4)).toEqual([0, 0, 1, 1])
    expect(waveBars([0.2, 0.4, 0.6, 0.8], [], 2)).toEqual([0.3, 0.7])
  })

  test("without bands (an older engine) the level drives every bar", () => {
    expect(waveBars(undefined, [], 3, 0.6)).toEqual([0.6, 0.6, 0.6])
  })

  test("the live words and the wave sit inside the composer's box", () => {
    const source = readFileSync(join(import.meta.dir, "dictation-button.tsx"), "utf8")
    expect(source).toContain('data-slot="prompt-input-box"')
    expect(source).toContain("onBands")
    expect(source).toContain("waveBars(")
  })
})
