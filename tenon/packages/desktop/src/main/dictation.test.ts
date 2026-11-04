import { expect, test } from "bun:test"
import { join } from "node:path"
import { createDictation, dictationPermissionHelp } from "./dictation"
import { dictationEngineFile, dictationModelURL, DICTATION_MODELS } from "./dictation-models"

const engine = join(import.meta.dir, "fixtures", "fake-dictation-engine.mjs")

test("stop without a recording rejects with not_recording", async () => {
  const dictation = createDictation({ command: process.execPath, args: [engine], log: () => {} })
  await expect(dictation.stop()).rejects.toMatchObject({ code: "not_recording" })
})

test("a stop that never answers times out, and the next start spawns a fresh engine", async () => {
  process.env.FAKE_DICTATION_HANG_STOP = "1"
  const dictation = createDictation({
    command: process.execPath,
    args: [engine],
    log: () => {},
    transcribeTimeout: 200,
  })
  try {
    await dictation.start()
    await expect(dictation.stop()).rejects.toMatchObject({ code: "transcribe_timeout" })
    expect(dictation.status()).toBe("idle")
  } finally {
    delete process.env.FAKE_DICTATION_HANG_STOP
  }
  await dictation.start()
  expect(await dictation.stop()).toBe("hello from the fake engine")
  dictation.dispose()
})

test("cancelling a transcription settles stop, and repeated cancels are not crashes", async () => {
  process.env.FAKE_DICTATION_HANG_STOP = "1"
  const dictation = createDictation({ command: process.execPath, args: [engine], log: () => {} })
  try {
    // One more round than the restart limit allows crashes.
    for (let round = 0; round < 6; round++) {
      await dictation.start()
      const stopped = dictation.stop()
      dictation.cancel()
      await expect(stopped).rejects.toMatchObject({ code: "cancelled" })
    }
  } finally {
    delete process.env.FAKE_DICTATION_HANG_STOP
    dictation.dispose()
  }
})

test("a recording that reaches the limit stops itself and stop collects the transcript", async () => {
  const dictation = createDictation({ command: process.execPath, args: [engine], log: () => {}, maxRecording: 100 })
  const limit = new Promise<void>((resolve) => dictation.onLimit(resolve))
  await dictation.start()
  await limit
  expect(await dictation.stop()).toBe("hello from the fake engine")
  expect(dictation.status()).toBe("idle")
  dictation.dispose()
})

test("an unused engine exits after the idle timeout, and the next start respawns it", async () => {
  const messages: string[] = []
  const dictation = createDictation({
    command: process.execPath,
    args: [engine],
    log: (message) => messages.push(message),
    idleTimeout: 100,
  })
  await dictation.start()
  await dictation.stop()
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(messages).toContain("dictation engine stopped")
  await dictation.start()
  expect(await dictation.stop()).toBe("hello from the fake engine")
  dictation.dispose()
})

test("platforms without a microphone switch get no permission help", () => {
  expect(dictationPermissionHelp("linux", "denied")).toBeUndefined()
  expect(dictationPermissionHelp("darwin", "not-determined")).toBeUndefined()
})

test("engine file names and model URLs per platform", () => {
  expect(dictationEngineFile("win32")).toBe("tenon-dictation.exe")
  expect(dictationEngineFile("darwin")).toBe("tenon-dictation")
  expect(DICTATION_MODELS.map((model) => model.name)).toEqual(["Whisper Small", "Whisper Turbo", "Parakeet V3"])
  expect(dictationModelURL(DICTATION_MODELS[0])).toStartWith(
    "https://huggingface.co/handy-computer/whisper-small-gguf/resolve/",
  )
})
