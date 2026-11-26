import { describe, expect, test } from "bun:test"
import { bootStage, deviceError, deviceHint, fitFrame } from "./device-boot"

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

describe("fitFrame", () => {
  test("fits a portrait screen by height and keeps its aspect", () => {
    expect(fitFrame({ boxWidth: 400, boxHeight: 516, imageWidth: 1080, imageHeight: 2400, inset: 8 })).toEqual({
      width: 225,
      height: 500,
    })
  })

  test("fits a landscape screen by width", () => {
    expect(fitFrame({ boxWidth: 316, boxHeight: 800, imageWidth: 2400, imageHeight: 1080, inset: 8 })).toEqual({
      width: 300,
      height: 135,
    })
  })

  test("never upscales and never exceeds the box", () => {
    expect(fitFrame({ boxWidth: 2000, boxHeight: 2000, imageWidth: 300, imageHeight: 600, inset: 8 })).toEqual({
      width: 300,
      height: 600,
    })
    const fitted = fitFrame({ boxWidth: 333, boxHeight: 271, imageWidth: 1080, imageHeight: 2400, inset: 8 })
    expect(fitted.width + 16).toBeLessThanOrEqual(333)
    expect(fitted.height + 16).toBeLessThanOrEqual(271)
  })

  test("returns nothing when there is no room or no image", () => {
    expect(fitFrame({ boxWidth: 10, boxHeight: 500, imageWidth: 1080, imageHeight: 2400, inset: 8 })).toEqual({
      width: 0,
      height: 0,
    })
    expect(fitFrame({ boxWidth: 400, boxHeight: 500, imageWidth: 0, imageHeight: 0, inset: 8 })).toEqual({
      width: 0,
      height: 0,
    })
  })
})

describe("deviceError", () => {
  test("drops the IPC prefix and repeated error labels", () => {
    expect(
      deviceError(
        new Error("Error invoking remote method 'device-screenshot': Error: error: device 'emulator-5554' not found"),
      ),
    ).toBe("device 'emulator-5554' not found")
  })

  test("keeps plain messages and non-errors", () => {
    expect(deviceError(new Error("The iOS Simulator only runs on macOS."))).toBe(
      "The iOS Simulator only runs on macOS.",
    )
    expect(deviceError("adb failed")).toBe("adb failed")
    expect(deviceError(new Error("Error: "))).toBe("Error: ")
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
