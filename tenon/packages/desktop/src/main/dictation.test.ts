import { expect, test } from "bun:test"
import { join } from "node:path"
import { createDictation, dictationPermissionHelp } from "./dictation"
import { dictationEngineFile, dictationModelURL, DICTATION_MODELS } from "./dictation-models"

const engine = join(import.meta.dir, "fixtures", "fake-dictation-engine.mjs")

test("stop without a recording rejects with not_recording", async () => {
  const dictation = createDictation({ command: process.execPath, args: [engine], log: () => {} })
  await expect(dictation.stop()).rejects.toMatchObject({ code: "not_recording" })
})

test("a configured model is loaded before recording starts", async () => {
  const dictation = createDictation({ command: process.execPath, args: [engine], log: () => {}, model: () => "m.gguf" })
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
