import { describe, expect, test } from "bun:test"
import { bootStage, deviceHint } from "./device-boot"

describe("bootStage", () => {
  test("is idle without a request or once the device runs", () => {
    expect(bootStage({ requestedAt: undefined, now: 0, running: false })).toBe("idle")
    expect(bootStage({ requestedAt: undefined, now: 500_000, running: true })).toBe("idle")
    expect(bootStage({ requestedAt: 0, now: 500_000, running: true })).toBe("idle")
  })

  test("moves from starting to slow at 60 s and to timeout at 180 s", () => {
    expect(bootStage({ requestedAt: 1_000, now: 1_000, running: false })).toBe("starting")
    expect(bootStage({ requestedAt: 1_000, now: 60_999, running: false })).toBe("starting")
    expect(bootStage({ requestedAt: 1_000, now: 61_000, running: false })).toBe("slow")
    expect(bootStage({ requestedAt: 1_000, now: 180_999, running: false })).toBe("slow")
    expect(bootStage({ requestedAt: 1_000, now: 181_000, running: false })).toBe("timeout")
  })
})

describe("deviceHint", () => {
  test("names Android devices that cannot be driven", () => {
    expect(deviceHint({ platform: "android", state: "unauthorized" })).toBe("unauthorized")
    expect(deviceHint({ platform: "android", state: "offline" })).toBe("offline")
  })

  test("leaves usable, iOS and unknown states alone", () => {
    expect(deviceHint({ platform: "android", state: "device" })).toBeUndefined()
    expect(deviceHint({ platform: "android", state: "recovery" })).toBeUndefined()
    expect(deviceHint({ platform: "ios", state: "offline" })).toBeUndefined()
    expect(deviceHint({ platform: "ios", state: "Booted" })).toBeUndefined()
  })
})
