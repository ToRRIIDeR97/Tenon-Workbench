import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createDictation, dictationPermissionHelp } from "./dictation"

// P2 · Dictation (implementations/notes-command-centre/implementation.md)

const engine = join(import.meta.dir, "fixtures", "fake-dictation-engine.mjs")
const log = () => {}

describe("createDictation", () => {
  test("AC-2.2 stop resolves with the final transcript", async () => {
    const dictation = createDictation({ command: process.execPath, args: [engine], log })
    await dictation.start()
    expect(dictation.status()).toBe("recording")
    expect(await dictation.stop()).toBe("hello from the fake engine")
    expect(dictation.status()).toBe("idle")
    dictation.cancel()
  })

  test("AC-2.2 level events reach onLevel while recording", async () => {
    const dictation = createDictation({ command: process.execPath, args: [engine], log })
    const levels: number[] = []
    dictation.onLevel((rms) => levels.push(rms))
    await dictation.start()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(levels).toContain(0.4)
    await dictation.stop()
  })

  test("AC-2.2 an engine that exits mid-recording rejects stop and respawns on the next start", async () => {
    process.env.FAKE_DICTATION_CRASH = "1"
    const dictation = createDictation({ command: process.execPath, args: [engine], log })
    try {
      await dictation.start()
      await expect(dictation.stop()).rejects.toMatchObject({ code: "engine_exited" })
    } finally {
      delete process.env.FAKE_DICTATION_CRASH
    }
    await dictation.start()
    expect(await dictation.stop()).toBe("hello from the fake engine")
  })

  test("a model load that never answers times out, and the next start spawns a fresh engine", async () => {
    process.env.FAKE_DICTATION_HANG_LOAD = "1"
    const dictation = createDictation({
      command: process.execPath,
      args: [engine],
      log,
      model: () => "model.bin",
      loadTimeout: 200,
    })
    try {
      await expect(dictation.start()).rejects.toMatchObject({ code: "engine_unavailable" })
      expect(dictation.status()).toBe("idle")
    } finally {
      delete process.env.FAKE_DICTATION_HANG_LOAD
    }
    await dictation.start()
    expect(await dictation.stop()).toBe("hello from the fake engine")
    dictation.dispose()
  })
})

describe("dictationPermissionHelp", () => {
  test("AC-2.3 macOS denied points at the microphone privacy pane", () => {
    expect(dictationPermissionHelp("darwin", "denied")).toEqual({
      key: "dictation.permission.macos",
      url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    })
  })

  test("AC-2.3 Windows denied points at the microphone privacy setting", () => {
    expect(dictationPermissionHelp("win32", "denied")).toEqual({
      key: "dictation.permission.windows",
      url: "ms-settings:privacy-microphone",
    })
  })

  test("AC-2.3 granted needs no help", () => {
    expect(dictationPermissionHelp("darwin", "granted")).toBeUndefined()
    expect(dictationPermissionHelp("win32", "granted")).toBeUndefined()
  })
})

test("AC-2.5 Handy's MIT notice and the engine crates are credited", () => {
  const notices = readFileSync(join(import.meta.dir, "..", "..", "..", "..", "..", "THIRD_PARTY_NOTICES.md"), "utf8")
  expect(notices).toContain("Copyright (c) 2025 CJ Pais")
  expect(notices).toContain("Permission is hereby granted, free of charge")
  expect(notices).toContain("transcribe-cpp")
  expect(notices).toContain("handy-recorder")
})
