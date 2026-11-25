import { expect, test } from "bun:test"
import { join } from "node:path"
import { createDictation } from "./dictation"

const engine = join(import.meta.dir, "fixtures", "fake-dictation-engine.mjs")

test("partial transcripts reach onPartial while recording, and start forwards the language", async () => {
  const dictation = createDictation({ command: process.execPath, args: [engine], log: () => {} })
  const partials: string[] = []
  const off = dictation.onPartial((text) => partials.push(text))
  try {
    await dictation.start({ language: "en" })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(partials).toEqual(["hello from"])
    expect(await dictation.stop()).toBe("hello (en)")
  } finally {
    off()
    dictation.dispose()
  }
})

test("a partial that arrives after stop is dropped", async () => {
  process.env.FAKE_DICTATION_LATE_PARTIAL = "1"
  const dictation = createDictation({ command: process.execPath, args: [engine], log: () => {} })
  const partials: string[] = []
  const off = dictation.onPartial((text) => partials.push(text))
  try {
    await dictation.start()
    const text = await dictation.stop()
    expect(text).toBe("hello from the fake engine")
    await dictation.start()
    await dictation.stop()
    expect(partials).not.toContain("too late")
  } finally {
    delete process.env.FAKE_DICTATION_LATE_PARTIAL
    off()
    dictation.dispose()
  }
})

test("a start without a language asks the engine to detect it", async () => {
  const dictation = createDictation({ command: process.execPath, args: [engine], log: () => {} })
  try {
    await dictation.start()
    expect(await dictation.stop()).toBe("hello from the fake engine")
  } finally {
    dictation.dispose()
  }
})
