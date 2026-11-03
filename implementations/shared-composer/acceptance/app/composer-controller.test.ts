import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { createRoot, createSignal } from "solid-js"
import {
  composerKeySends,
  createComposerController,
} from "../../../../tenon/packages/app/src/components/prompt-input/composer-controller"

const app = path.resolve(import.meta.dir, "../../../../tenon/packages/app/src")

function setup(input: Parameters<typeof createComposerController>[0]) {
  return createRoot(() => createComposerController(input))
}

function deferred() {
  const result = {} as { promise: Promise<boolean>; resolve: (value: boolean) => void }
  result.promise = new Promise<boolean>((resolve) => (result.resolve = resolve))
  return result
}

describe("AC-1 guards", () => {
  test("AC-1 empty or whitespace text does not call send", async () => {
    const calls: string[] = []
    const composer = setup({ send: async (text) => (calls.push(text), true) })
    expect(composer.canSend()).toBe(false)
    expect(await composer.send()).toBe(false)
    composer.setValue("   ")
    expect(composer.canSend()).toBe(false)
    expect(await composer.send()).toBe(false)
    expect(calls).toEqual([])
  })

  test("AC-1 disabled or blocked composer does not call send and keeps its text", async () => {
    const calls: string[] = []
    const [disabled, setDisabled] = createSignal(true)
    const [blocked, setBlocked] = createSignal(false)
    const composer = setup({ send: async (text) => (calls.push(text), true), disabled, blocked })
    composer.setValue("hello")
    expect(composer.disabled()).toBe(true)
    expect(composer.canSend()).toBe(false)
    expect(await composer.send()).toBe(false)
    setDisabled(false)
    setBlocked(true)
    expect(composer.canSend()).toBe(false)
    expect(await composer.send()).toBe(false)
    expect(calls).toEqual([])
    expect(composer.value()).toBe("hello")
  })
})

describe("AC-2 keyboard", () => {
  test("AC-2 Enter sends; Shift+Enter, IME composition and other keys do not", () => {
    expect(composerKeySends({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true)
    expect(composerKeySends({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false)
    expect(composerKeySends({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false)
    expect(composerKeySends({ key: "a", shiftKey: false, isComposing: false })).toBe(false)
  })
})

describe("AC-3 busy", () => {
  test("AC-3 a send in flight marks the composer busy and ignores a second send", async () => {
    const calls: string[] = []
    const pending = deferred()
    const composer = setup({ send: (text) => (calls.push(text), pending.promise) })
    composer.setValue("one")
    const first = composer.send()
    expect(composer.busy()).toBe(true)
    expect(composer.canSend()).toBe(false)
    expect(await composer.send()).toBe(false)
    pending.resolve(true)
    expect(await first).toBe(true)
    expect(composer.busy()).toBe(false)
    expect(calls).toEqual(["one"])
  })
})

describe("AC-4 result", () => {
  test("AC-4 the page's send gets trimmed text and success clears the box", async () => {
    const calls: string[] = []
    const composer = setup({ send: async (text) => (calls.push(text), true) })
    composer.setValue("  plan my day \n")
    expect(await composer.send()).toBe(true)
    expect(calls).toEqual(["plan my day"])
    expect(composer.value()).toBe("")
  })

  test("AC-4 a failed send keeps the text", async () => {
    const composer = setup({ send: async () => false })
    composer.setValue("retry me")
    expect(await composer.send()).toBe(false)
    expect(composer.value()).toBe("retry me")
    expect(composer.busy()).toBe(false)
  })

  test("AC-4 a send that throws keeps the text and resolves false", async () => {
    const composer = setup({
      send: async () => {
        throw new Error("offline")
      },
    })
    composer.setValue("retry me")
    expect(await composer.send()).toBe(false)
    expect(composer.value()).toBe("retry me")
    expect(composer.busy()).toBe(false)
  })

  test("AC-4 text typed while sending survives a successful send", async () => {
    const pending = deferred()
    const composer = setup({ send: () => pending.promise })
    composer.setValue("first")
    const sent = composer.send()
    composer.setValue("first and more")
    pending.resolve(true)
    await sent
    expect(composer.value()).toBe("first and more")
  })
})

describe("AC-5 one composer", () => {
  test("AC-5 Home, the Command Centre page and the strip render ComposerBox, not their own fields", () => {
    for (const file of ["pages/brain-home.tsx", "pages/command-centre.tsx", "features/command-centre/command-strip.tsx"]) {
      const source = readFileSync(path.join(app, file), "utf8")
      expect(source).toContain("<ComposerBox")
      expect(source).toContain("createComposerController(")
      expect(source).not.toContain("<textarea")
      expect(source).not.toMatch(/<input\s[^>]*type="text"/)
    }
  })
})
