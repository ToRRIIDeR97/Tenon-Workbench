import { describe, expect, test } from "bun:test"
import { createDraftStore } from "./draft-store"

function memoryDriver() {
  const documents = new Map<string, string>()
  const writes: Array<[string, string]> = []
  return {
    documents,
    writes,
    driver: {
      get: async (key: string) => documents.get(key) ?? null,
      set: async (key: string, value: string) => {
        writes.push([key, value])
        documents.set(key, value)
      },
      remove: async (key: string) => void documents.delete(key),
      putBlob: async () => "blob",
      getBlob: async () => null,
    },
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("createDraftStore", () => {
  test("writes only the last of a burst of changes after the quiet period", async () => {
    const memory = memoryDriver()
    const store = createDraftStore(memory.driver, { delay: 20 })
    void store.setItem("prompt", JSON.stringify({ text: "h" }))
    void store.setItem("prompt", JSON.stringify({ text: "he" }))
    const done = store.setItem("prompt", JSON.stringify({ text: "hey" }))
    await wait(5)
    expect(memory.writes).toEqual([])
    await done
    expect(memory.writes).toEqual([["prompt", JSON.stringify({ text: "hey" })]])
    await wait(40)
    expect(memory.writes).toHaveLength(1)
  })

  test("a read returns a write that is still waiting", async () => {
    const memory = memoryDriver()
    const store = createDraftStore(memory.driver, { delay: 10_000 })
    void store.setItem("prompt", JSON.stringify({ text: "draft" }))
    expect(await store.getItem("prompt")).toBe(JSON.stringify({ text: "draft" }))
  })

  test("a remove is not undone by a write that was still waiting", async () => {
    const memory = memoryDriver()
    const store = createDraftStore(memory.driver, { delay: 10 })
    memory.documents.set("prompt", JSON.stringify({ text: "old" }))
    const pending = store.setItem("prompt", JSON.stringify({ text: "new" }))
    await store.removeItem("prompt")
    await pending
    await wait(30)
    expect(memory.writes).toEqual([])
    expect(await store.getItem("prompt")).toBeNull()
  })

  test("a failed write rejects its setItem call but not a later read", async () => {
    const memory = memoryDriver()
    memory.documents.set("prompt", JSON.stringify({ text: "stored" }))
    const store = createDraftStore(
      { ...memory.driver, set: async () => Promise.reject(new Error("disk")) },
      { delay: 10_000 },
    )
    const pending = store.setItem("prompt", JSON.stringify({ text: "new" }))
    expect(await store.getItem("prompt")).toBe(JSON.stringify({ text: "stored" }))
    await expect(pending).rejects.toThrow("disk")
  })

  test("pending writes land when the page is hidden or unloaded", async () => {
    const memory = memoryDriver()
    const store = createDraftStore(memory.driver, { delay: 10_000 })
    void store.setItem("a", JSON.stringify({ text: "a" }))
    window.dispatchEvent(new Event("pagehide"))
    await wait(0)
    expect(memory.documents.get("a")).toBe(JSON.stringify({ text: "a" }))

    void store.setItem("b", JSON.stringify({ text: "b" }))
    await store.flush()
    expect(memory.documents.get("b")).toBe(JSON.stringify({ text: "b" }))
  })
})
