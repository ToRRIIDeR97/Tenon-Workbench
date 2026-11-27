import { describe, expect, test } from "bun:test"
import { bootStage, deviceHint } from "../../../tenon/packages/app/src/pages/session/device-boot"

describe("P2 device boot feedback", () => {
  test("AC-P2-6 no request is idle", () => {
    expect(bootStage({ requestedAt: undefined, now: 5_000, running: false })).toBe("idle")
  })

  test("AC-P2-6 a fresh request is starting", () => {
    expect(bootStage({ requestedAt: 1_000, now: 20_000, running: false })).toBe("starting")
  })

  test("AC-P2-6 a long boot is slow, then times out", () => {
    expect(bootStage({ requestedAt: 0, now: 90_000, running: false })).toBe("slow")
    expect(bootStage({ requestedAt: 0, now: 200_000, running: false })).toBe("timeout")
  })

  test("AC-P2-6 a running device ends the boot", () => {
    expect(bootStage({ requestedAt: 0, now: 90_000, running: true })).toBe("idle")
  })

  test("AC-P2-7 attached Android devices that cannot be used get a hint", () => {
    expect(deviceHint({ platform: "android", state: "unauthorized" })).toBe("unauthorized")
    expect(deviceHint({ platform: "android", state: "offline" })).toBe("offline")
    expect(deviceHint({ platform: "android", state: "device" })).toBeUndefined()
  })
})
