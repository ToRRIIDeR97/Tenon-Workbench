import { describe, expect, test } from "bun:test"
import { wavBytes } from "./wav"

describe("AC-25 the WAV handed to the engine", () => {
  test("has a RIFF/WAVE header for 16 kHz mono 16-bit and the samples, clamped", () => {
    const bytes = wavBytes(new Float32Array([0, 1, -1, 2]), 16_000)
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF")
    expect(bytes.toString("ascii", 8, 12)).toBe("WAVE")
    expect(bytes.readUInt16LE(22)).toBe(1)
    expect(bytes.readUInt32LE(24)).toBe(16_000)
    expect(bytes.readUInt16LE(34)).toBe(16)
    expect(bytes.readUInt32LE(40)).toBe(8)
    expect([0, 1, 2, 3].map((index) => bytes.readInt16LE(44 + index * 2))).toEqual([0, 32767, -32767, 32767])
  })
})
