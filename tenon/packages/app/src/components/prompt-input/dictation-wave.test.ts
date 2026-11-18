import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { levelReading, voiceGain, waveBars } from "./dictation-wave"

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

  test("ordinary speech fills the wave and a quiet room stays flat", () => {
    // Speech into a laptop mic: bands around 0.1–0.4 of the engine's full scale.
    const speech = voiceGain([0.05, 0.3, 0.4, 0.25], 0)
    expect(Math.max(...speech.values)).toBeGreaterThan(0.9)
    expect(speech.values[0]).toBe(0)
    // Room noise after the speech: the gain relaxes slowly and the bars stay near the line.
    const quiet = voiceGain([0.06, 0.1, 0.08, 0.05], speech.peak)
    expect(Math.max(...quiet.values)).toBe(0)
    // A quiet room on its own is not blown up.
    expect(Math.max(...voiceGain([0.15, 0.2], 0).values)).toBeLessThan(0.4)
  })

  test("an older engine's loudness uses the same scale", () => {
    expect(levelReading(0)).toBe(0)
    expect(levelReading(1)).toBe(1)
    expect(levelReading(0.03)).toBeGreaterThan(0.4)
  })

  test("the live words and the wave sit inside the composer's box", () => {
    const source = readFileSync(join(import.meta.dir, "dictation-button.tsx"), "utf8")
    expect(source).toContain('data-slot="prompt-input-box"')
    expect(source).toContain("onBands")
    expect(source).toContain("waveBars(")
  })
})
