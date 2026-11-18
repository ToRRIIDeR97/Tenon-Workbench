import { expect, test } from "bun:test"
import { join } from "node:path"
import { createDictation } from "./dictation"

// Acceptance test for implementations/harness-ux-batch-2 (AC-6, desktop side): the engine's live transcript
// reaches listeners while recording, and the spoken language goes with "start".

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

// Panel round 3: a live transcript that arrives after stop never reaches the window.
test("a partial that arrives after stop is dropped", async () => {
  process.env.FAKE_DICTATION_LATE_PARTIAL = "1"
  const dictation = createDictation({ command: process.execPath, args: [engine], log: () => {} })
  const partials: string[] = []
  const off = dictation.onPartial((text) => partials.push(text))
  try {
    await dictation.start()
    const text = await dictation.stop()
    expect(text).toBe("hello from the fake engine")
    // The late partial is written right after the final; a second recording proves the engine's output was read.
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
