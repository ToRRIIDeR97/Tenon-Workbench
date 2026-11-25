import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { levelReading, voiceGain, waveBars } from "./dictation-wave"

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
    const speech = voiceGain([0.05, 0.3, 0.4, 0.25], 0)
    expect(Math.max(...speech.values)).toBeGreaterThan(0.9)
    expect(speech.values[0]).toBe(0)
    const quiet = voiceGain([0.06, 0.1, 0.08, 0.05], speech.peak)
    expect(Math.max(...quiet.values)).toBe(0)
    expect(Math.max(...voiceGain([0.15, 0.2], 0).values)).toBeLessThan(0.4)
  })

  test("an older engine's loudness uses the same scale", () => {
    expect(levelReading(0)).toBe(0)
    expect(levelReading(1)).toBe(1)
    expect(levelReading(0.03)).toBeGreaterThan(0.4)
  })

  test("the capsule sits over the composer's box and its meter follows the bands", () => {
    const source = readFileSync(join(import.meta.dir, "dictation-button.tsx"), "utf8")
    expect(source).toContain('data-slot="prompt-input-box"')
    expect(source).toContain("onBands")
    expect(source).toContain("waveBars(")
    expect(source).toContain('data-component="dictation-capsule"')
  })

  test("the toolbar stays while recording and the words in progress are faint and italic", () => {
    const source = readFileSync(join(import.meta.dir, "dictation-button.tsx"), "utf8")
    expect(source).not.toContain('controls.style.display = "none"')
    const css = readFileSync(join(import.meta.dir, "dictation.css"), "utf8")
    const ghost = css.slice(css.indexOf('[data-slot="dictation-ghost"] {'))
    expect(ghost.slice(0, 200)).toContain("font-style: italic")
    expect(ghost.slice(0, 200)).toContain("--v2-text-text-faint")
  })
})
