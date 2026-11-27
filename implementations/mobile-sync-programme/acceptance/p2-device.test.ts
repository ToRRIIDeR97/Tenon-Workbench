import { describe, expect, test } from "bun:test"
import path from "node:path"
import { androidText, inputCommands, sdkRootCandidates } from "../../../tenon/packages/desktop/src/main/device"

describe("P2 device input commands", () => {
  test("AC-P2-1 iOS home presses the Home button", () => {
    expect(inputCommands("ios", "SIM-1", { kind: "key", key: "home" })).toEqual([
      { tool: "idb", args: ["ui", "button", "--udid", "SIM-1", "HOME"] },
    ])
  })

  test("AC-P2-1 iOS enter sends the HID Return key", () => {
    expect(inputCommands("ios", "SIM-1", { kind: "key", key: "enter" })).toEqual([
      { tool: "idb", args: ["ui", "key", "--udid", "SIM-1", "40"] },
    ])
  })

  test("AC-P2-1 iOS back is refused", () => {
    expect(() => inputCommands("ios", "SIM-1", { kind: "key", key: "back" })).toThrow(/Back/)
  })

  test("AC-P2-2 Android keys keep their key events", () => {
    expect(inputCommands("android", "emulator-5554", { kind: "key", key: "back" })).toEqual([
      { tool: "adb", args: ["-s", "emulator-5554", "shell", "input", "keyevent", "KEYCODE_BACK"] },
    ])
    expect(inputCommands("android", "emulator-5554", { kind: "key", key: "home" })).toEqual([
      { tool: "adb", args: ["-s", "emulator-5554", "shell", "input", "keyevent", "KEYCODE_HOME"] },
    ])
    expect(inputCommands("android", "emulator-5554", { kind: "key", key: "enter" })).toEqual([
      { tool: "adb", args: ["-s", "emulator-5554", "shell", "input", "keyevent", "KEYCODE_ENTER"] },
    ])
  })

  test("AC-P2-3 Android text is one escaped input", () => {
    expect(inputCommands("android", "emulator-5554", { kind: "text", text: "hello world" })).toEqual([
      { tool: "adb", args: ["-s", "emulator-5554", "shell", "input", "text", androidText("hello world")] },
    ])
  })

  test("AC-P2-3 Android text outside ASCII is refused", () => {
    expect(() => inputCommands("android", "emulator-5554", { kind: "text", text: "café" })).toThrow(/ASCII/)
  })

  test("AC-P2-3 Android line breaks become Enter between the pieces", () => {
    expect(inputCommands("android", "emulator-5554", { kind: "text", text: "one\ntwo" })).toEqual([
      { tool: "adb", args: ["-s", "emulator-5554", "shell", "input", "text", "one"] },
      { tool: "adb", args: ["-s", "emulator-5554", "shell", "input", "keyevent", "KEYCODE_ENTER"] },
      { tool: "adb", args: ["-s", "emulator-5554", "shell", "input", "text", "two"] },
    ])
  })

  test("AC-P2-3 empty Android text runs nothing", () => {
    expect(inputCommands("android", "emulator-5554", { kind: "text", text: "" })).toEqual([])
  })

  test("AC-P2-4 taps are rounded and never negative", () => {
    expect(inputCommands("android", "emulator-5554", { kind: "tap", x: 10.6, y: -4 })).toEqual([
      { tool: "adb", args: ["-s", "emulator-5554", "shell", "input", "tap", "11", "0"] },
    ])
    expect(inputCommands("ios", "SIM-1", { kind: "tap", x: 10.6, y: -4 })).toEqual([
      { tool: "idb", args: ["ui", "tap", "--udid", "SIM-1", "11", "0"] },
    ])
  })

  test("AC-P2-4 Android swipes keep the 300 ms duration", () => {
    expect(inputCommands("android", "emulator-5554", { kind: "swipe", x: 1, y: 2, toX: 3, toY: 4 })).toEqual([
      { tool: "adb", args: ["-s", "emulator-5554", "shell", "input", "swipe", "1", "2", "3", "4", "300"] },
    ])
  })
})

describe("P2 Android SDK discovery", () => {
  test("AC-P2-5 Windows uses the environment, then LOCALAPPDATA", () => {
    expect(
      sdkRootCandidates({
        env: { ANDROID_HOME: "D:\\sdk", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
        platform: "win32",
        home: "C:\\Users\\me",
      }),
    ).toEqual(["D:\\sdk", path.win32.join("C:\\Users\\me\\AppData\\Local", "Android", "Sdk")])
  })

  test("AC-P2-5 Windows without LOCALAPPDATA returns no relative path", () => {
    expect(sdkRootCandidates({ env: {}, platform: "win32", home: "C:\\Users\\me" })).toEqual([])
  })

  test("AC-P2-5 macOS uses the Library folder", () => {
    expect(sdkRootCandidates({ env: {}, platform: "darwin", home: "/Users/me" })).toEqual([
      path.posix.join("/Users/me", "Library", "Android", "sdk"),
    ])
  })
})
