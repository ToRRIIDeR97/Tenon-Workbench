import { afterEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createFileFind } from "@tenon/session-ui/pierre/file-find"

const ctrlF = () => new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true })

describe("AC-3 mod+F with a file viewer mounted", () => {
  const disposers: (() => void)[] = []
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
    document.body.innerHTML = ""
  })

  const mountViewer = () => {
    const wrapper = document.createElement("div")
    wrapper.tabIndex = 0
    document.body.append(wrapper)
    createRoot((dispose) => {
      disposers.push(dispose)
      createFileFind({ wrapper: () => wrapper, overlay: () => undefined, getRoot: () => undefined })
    })
    return wrapper
  }

  test("focus outside every file viewer leaves the shortcut to the page find", async () => {
    let reached = 0
    const listen = (event: KeyboardEvent) => {
      if (event.key === "f" && event.ctrlKey) reached++
    }
    document.addEventListener("keydown", listen, { capture: true })
    mountViewer()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const thread = document.createElement("div")
    thread.tabIndex = 0
    document.body.append(thread)
    thread.focus()
    const event = ctrlF()
    thread.dispatchEvent(event)
    document.removeEventListener("keydown", listen, { capture: true })
    expect(reached).toBe(1)
    expect(event.defaultPrevented).toBe(false)
  })

  test("focus inside a file viewer keeps the viewer's own find", async () => {
    const wrapper = mountViewer()
    await new Promise((resolve) => setTimeout(resolve, 0))
    wrapper.focus()
    const event = ctrlF()
    wrapper.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
