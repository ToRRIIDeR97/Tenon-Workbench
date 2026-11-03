import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createComposerController } from "../../../../tenon/packages/app/src/components/prompt-input/composer-controller"

function setup(input: Parameters<typeof createComposerController>[0]) {
  return createRoot(() => createComposerController(input))
}

describe("verification: composer controller", () => {
  test("AC-1 canSend follows disabled and blocked as they change after creation", () => {
    const [disabled, setDisabled] = createSignal(false)
    const [blocked, setBlocked] = createSignal(false)
    const composer = setup({ send: () => true, disabled, blocked })
    composer.setValue("x")
    expect(composer.canSend()).toBe(true)
    setBlocked(true)
    expect(composer.canSend()).toBe(false)
    expect(composer.disabled()).toBe(false)
    setBlocked(false)
    setDisabled(true)
    expect(composer.canSend()).toBe(false)
    setDisabled(false)
    expect(composer.canSend()).toBe(true)
  })

  test("AC-1 a newline-only draft is empty", async () => {
    let called = false
    const composer = setup({ send: () => ((called = true), true) })
    composer.setValue("\n\n\t")
    expect(await composer.send()).toBe(false)
    expect(called).toBe(false)
  })

  test("AC-3 a synchronous page send still clears busy and the box", async () => {
    const composer = setup({ send: () => true })
    composer.setValue("sync")
    expect(await composer.send()).toBe(true)
    expect(composer.busy()).toBe(false)
    expect(composer.value()).toBe("")
  })

  test("AC-3 after a failed send, the next send goes through", async () => {
    const results = [false, true]
    const calls: string[] = []
    const composer = setup({ send: async (text) => (calls.push(text), results.shift() ?? false) })
    composer.setValue("again")
    expect(await composer.send()).toBe(false)
    expect(await composer.send()).toBe(true)
    expect(calls).toEqual(["again", "again"])
    expect(composer.value()).toBe("")
  })

  test("AC-4 an edit made while a send fails is kept", async () => {
    let fail!: () => void
    const composer = setup({
      send: () => new Promise<boolean>((_, reject) => (fail = () => reject(new Error("down")))),
    })
    composer.setValue("draft")
    const sent = composer.send()
    composer.setValue("draft, edited")
    fail()
    expect(await sent).toBe(false)
    expect(composer.value()).toBe("draft, edited")
  })

  test("AC-4 the initial value is used and sent", async () => {
    const calls: string[] = []
    const composer = setup({ send: (text) => (calls.push(text), true), initial: "restored" })
    expect(composer.value()).toBe("restored")
    await composer.send()
    expect(calls).toEqual(["restored"])
  })
})
