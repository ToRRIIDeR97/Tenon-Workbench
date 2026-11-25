import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { replyAsks } from "./thread-finish"

describe("replyAsks", () => {
  test("a reply already in memory is read without loading", async () => {
    let loads = 0
    const asks = await replyAsks({
      read: () => "Which one should I use?",
      load: async () => {
        loads++
      },
    })
    expect(asks).toBe(true)
    expect(loads).toBe(0)
  })

  test("a load that never settles gives up after the timeout and reads as not asking", async () => {
    const started = Date.now()
    const asks = await replyAsks({ read: () => "", load: () => new Promise(() => {}), timeout: 30 })
    expect(asks).toBe(false)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  test("a load that fails reads as not asking, without throwing", async () => {
    const asks = await replyAsks({
      read: () => "",
      load: () => Promise.reject(new Error("offline")),
      timeout: 1_000,
    })
    expect(asks).toBe(false)
  })

  test("a load that throws before returning a promise reads as not asking", async () => {
    const asks = await replyAsks({
      read: () => "",
      load: () => {
        throw new Error("no server")
      },
      timeout: 1_000,
    })
    expect(asks).toBe(false)
  })

  test("a loaded reply is read after the load", async () => {
    let text = ""
    const asks = await replyAsks({
      read: () => text,
      load: async () => {
        text = "Done. Shall I also update the docs?"
      },
    })
    expect(asks).toBe(true)
  })
})

describe("design values and leftovers", () => {
  const src = join(import.meta.dir, "..", "..")
  const read = (path: string) => readFileSync(join(src, path), "utf8")

  test("the running halo peaks at 0.35 and the answer field's focus edge is 1.5px in the focus colour", () => {
    const halo = read("index.css")
    expect(halo.slice(halo.indexOf("@keyframes running-breathe-halo"))).toContain("opacity: 0.35")
    const parts = readFileSync(join(src, "..", "..", "session-ui", "src", "components", "message-part.css"), "utf8")
    expect(parts).toContain("box-shadow: inset 0 0 0 1.5px var(--v2-border-border-focus)")
  })

  test("nothing passes the removed canvas prop to the rail", () => {
    expect(read("pages/session.tsx")).not.toContain("canvas={tabState.canvasOpen()}")
    expect(read("pages/session/session-side-rail.tsx")).not.toContain("canvas: boolean")
  })
})
