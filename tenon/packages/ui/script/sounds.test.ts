import { describe, expect, test } from "bun:test"
import { render, sounds, wav } from "./sounds"

describe("Tenon sounds", () => {
  test.each(sounds.map((sound) => [sound.name, sound] as const))("%s", (_name, sound) => {
    const samples = render(sound)
    expect(samples.length / 44_100).toBeLessThan(0.8)
    expect(Math.abs(samples[0]!)).toBeLessThan(0.001)
    expect(Math.abs(samples.at(-1)!)).toBeLessThan(0.001)
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
    expect(20 * Math.log10(peak)).toBeCloseTo(-9, 1)
    expect(wav(samples).length).toBe(44 + samples.length * 2)
  })

  test("each family has done, attention and error", () => {
    const names = sounds.map((sound) => sound.name)
    for (const family of ["glass", "soft", "pulse"])
      for (const event of ["done", "attention", "error"]) expect(names).toContain(`tenon-${family}-${event}`)
  })
})
