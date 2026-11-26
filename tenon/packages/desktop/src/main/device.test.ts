import { describe, expect, test } from "bun:test"
import path from "node:path"
import { androidText, inputCommands, parseAdbDevices, parseSimctl, sdkRootCandidates } from "./device"

describe("device parsing", () => {
  test("reads adb devices -l", () => {
    const out = [
      "List of devices attached",
      "emulator-5554          device product:sdk_gphone64 model:sdk_gphone64_x86_64 device:emu64x transport_id:1",
      "R58N12345             unauthorized usb:1-1 transport_id:2",
      "",
    ].join("\n")
    expect(parseAdbDevices(out)).toEqual([
      { platform: "android", id: "emulator-5554", state: "device", name: "sdk gphone64 x86 64" },
      { platform: "android", id: "R58N12345", state: "unauthorized", name: "R58N12345" },
    ])
  })

  test("reads available iOS simulators from simctl", () => {
    const out = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
          { udid: "A1", name: "iPhone 16", state: "Booted", isAvailable: true },
          { udid: "A2", name: "iPhone SE", state: "Shutdown", isAvailable: false },
        ],
        "com.apple.CoreSimulator.SimRuntime.watchOS-12-0": [{ udid: "W1", name: "Watch", state: "Shutdown" }],
      },
    })
    expect(parseSimctl(out)).toEqual([{ platform: "ios", id: "A1", name: "iPhone 16", state: "Booted" }])
  })

  test("escapes text for adb input", () => {
    expect(androidText("hello world")).toBe("hello%sworld")
    expect(androidText("a&b;c")).toBe("a\\&b\\;c")
    expect(androidText("me@test.dev")).toBe("me@test.dev")
  })
})

const adbText = (text: string) => ({ tool: "adb", args: ["-s", "e1", "shell", "input", "text", text] })
const adbEnter = { tool: "adb", args: ["-s", "e1", "shell", "input", "keyevent", "KEYCODE_ENTER"] }

describe("inputCommands", () => {
  test("Android CRLF, blank and trailing lines press Enter in order", () => {
    expect(inputCommands("android", "e1", { kind: "text", text: "a b\r\n\r\nc\n" })).toEqual([
      adbText("a%sb"),
      adbEnter,
      adbEnter,
      adbText("c"),
      adbEnter,
    ])
    expect(inputCommands("android", "e1", { kind: "text", text: "\n" })).toEqual([adbEnter])
  })

  test("Android accepts every printable ASCII character", () => {
    const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join("")
    expect(inputCommands("android", "e1", { kind: "text", text: printable })).toEqual([adbText(androidText(printable))])
  })

  test("Android refuses tabs, lone carriage returns and non-ASCII text", () => {
    for (const text of ["a\tb", "a\rb", "naïve", "ok\n😀"])
      expect(() => inputCommands("android", "e1", { kind: "text", text })).toThrow(/ASCII/)
  })

  test("iOS swipes round coordinates and text passes through", () => {
    expect(inputCommands("ios", "S", { kind: "swipe", x: -2, y: 1.4, toX: 3.5, toY: 9 })).toEqual([
      { tool: "idb", args: ["ui", "swipe", "--udid", "S", "0", "1", "4", "9"] },
    ])
    expect(inputCommands("ios", "S", { kind: "text", text: "café\nok" })).toEqual([
      { tool: "idb", args: ["ui", "text", "--udid", "S", "café\nok"] },
    ])
    expect(inputCommands("ios", "S", { kind: "text", text: "" })).toEqual([])
  })
})

describe("inputCommands validation", () => {
  test("non-finite coordinates become 0", () => {
    expect(inputCommands("android", "e1", { kind: "tap", x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual([
      { tool: "adb", args: ["-s", "e1", "shell", "input", "tap", "0", "0"] },
    ])
    expect(
      inputCommands("ios", "S", { kind: "swipe", x: Number.NEGATIVE_INFINITY, y: 3, toX: Number.NaN, toY: 4.6 }),
    ).toEqual([{ tool: "idb", args: ["ui", "swipe", "--udid", "S", "0", "3", "0", "5"] }])
  })

  test("refuses unknown kinds, keys and non-string text on both platforms", () => {
    const bad: unknown[] = [
      { kind: "scroll", x: 1, y: 2 },
      { kind: "key", key: "menu" },
      { kind: "key" },
      { kind: "text", text: 5 },
      { kind: "text" },
      null,
      "tap",
    ]
    for (const platform of ["android", "ios"] as const)
      for (const input of bad)
        expect(() => inputCommands(platform, "d", input as Parameters<typeof inputCommands>[2])).toThrow(
          /Device (input|keys|text)/,
        )
  })
})

describe("sdkRootCandidates", () => {
  test("reads both variables in order and skips empty ones", () => {
    expect(
      sdkRootCandidates({
        env: { ANDROID_HOME: "", ANDROID_SDK_ROOT: "/opt/sdk", LOCALAPPDATA: "" },
        platform: "linux",
        home: "/home/me",
      }),
    ).toEqual(["/opt/sdk", path.posix.join("/home/me", "Android", "Sdk")])
    expect(
      sdkRootCandidates({
        env: { ANDROID_HOME: "C:\\a", ANDROID_SDK_ROOT: "C:\\b", LOCALAPPDATA: "C:\\L" },
        platform: "win32",
        home: "C:\\Users\\me",
      }),
    ).toEqual(["C:\\a", "C:\\b", path.win32.join("C:\\L", "Android", "Sdk")])
  })

  test("never returns a relative path", () => {
    expect(sdkRootCandidates({ env: {}, platform: "linux", home: "" })).toEqual([])
    expect(sdkRootCandidates({ env: { ANDROID_HOME: "sdk" }, platform: "darwin", home: "/Users/me" })).toEqual([
      path.posix.join("/Users/me", "Library", "Android", "sdk"),
    ])
  })
})
