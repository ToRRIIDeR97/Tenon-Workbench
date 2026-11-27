import { describe, expect, test } from "bun:test"
import { companionSession } from "./companion"

function memory() {
  const data = new Map<string, string>()
  return {
    data,
    get: async (key: string) => data.get(key) ?? null,
    set: async (key: string, value: string) => void data.set(key, value),
    remove: async (key: string) => void data.delete(key),
  }
}

describe("AC-P8-4 the pairing survives a restart and sign-out forgets it", () => {
  test("a saved pairing loads again and sign-out removes it", async () => {
    const store = memory()
    const first = companionSession(store)
    expect(await first.load()).toBeUndefined()
    await first.save({ url: "http://192.168.1.20:47100", id: "dev_1", name: "Pixel", token: "secret-token" })
    const second = companionSession(store)
    expect(await second.load()).toEqual({
      url: "http://192.168.1.20:47100",
      id: "dev_1",
      name: "Pixel",
      token: "secret-token",
    })
    await second.signOut()
    expect(await companionSession(store).load()).toBeUndefined()
    expect(store.data.size).toBe(0)
  })

  test("a damaged entry reads as not paired", async () => {
    const store = memory()
    store.data.set("tenon.companion", "{not json")
    expect(await companionSession(store).load()).toBeUndefined()
    store.data.set("tenon.companion", JSON.stringify({ url: "ftp://x", token: "t", id: "d", name: "n" }))
    expect(await companionSession(store).load()).toBeUndefined()
  })
})
