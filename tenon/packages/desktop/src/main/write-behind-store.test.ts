import { describe, expect, test } from "bun:test"
import { createWriteBehindStore } from "./write-behind-store"

function backend(files: Record<string, Record<string, unknown>> = {}) {
  const calls = { read: 0, write: 0 }
  return {
    files,
    calls,
    read(name: string) {
      calls.read++
      return { ...files[name] }
    },
    write(name: string, data: Record<string, unknown>) {
      calls.write++
      files[name] = { ...data }
    },
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("write-behind store", () => {
  test("reads a file once and serves later gets from memory", () => {
    const disk = backend({ "a.dat": { k: "v" } })
    const store = createWriteBehindStore(disk, 10)
    expect(store.get("a.dat", "k")).toBe("v")
    expect(store.get("a.dat", "k")).toBe("v")
    expect(store.keys("a.dat")).toEqual(["k"])
    expect(disk.calls.read).toBe(1)
  })

  test("coalesces a burst of sets into one write", async () => {
    const disk = backend()
    const store = createWriteBehindStore(disk, 10)
    for (let i = 0; i < 60; i++) store.set("a.dat", "width", String(i))
    expect(store.get("a.dat", "width")).toBe("59")
    expect(disk.calls.write).toBe(0)
    await wait(30)
    expect(disk.calls.write).toBe(1)
    expect(disk.files["a.dat"]).toEqual({ width: "59" })
  })

  test("flush writes pending stores immediately", () => {
    const disk = backend()
    const store = createWriteBehindStore(disk, 10_000)
    store.set("a.dat", "x", "1")
    store.set("b.dat", "y", "2")
    store.flush()
    expect(disk.files).toEqual({ "a.dat": { x: "1" }, "b.dat": { y: "2" } })
    store.flush()
    expect(disk.calls.write).toBe(2)
  })

  test("delete and clear reach disk without waiting", () => {
    const disk = backend({ "a.dat": { x: "1", y: "2" } })
    const store = createWriteBehindStore(disk, 10_000)
    store.delete("a.dat", "x")
    expect(disk.files["a.dat"]).toEqual({ y: "2" })
    store.clear("a.dat")
    expect(disk.files["a.dat"]).toEqual({})
  })

  test("forget drops pending writes and re-reads the file", () => {
    const disk = backend({ "a.dat": { x: "old" } })
    const store = createWriteBehindStore(disk, 10_000)
    store.set("a.dat", "x", "new")
    store.forget("a.dat")
    store.flush()
    expect(disk.calls.write).toBe(0)
    expect(store.get("a.dat", "x")).toBe("old")
  })
})
