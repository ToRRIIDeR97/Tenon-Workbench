import { describe, expect, test } from "bun:test"
import { rootThread } from "./thread-owner"

const roots = new Map([["ses_root", { title: "Migrate the billing webhook" }]])
const none = () => undefined

describe("rootThread", () => {
  test("a root thread is its own owner", () => {
    expect(rootThread("ses_root", roots, none, {})?.title).toBe("Migrate the billing webhook")
  })

  test("a subagent the synced store holds reaches its root", () => {
    const synced = (id: string) => ({ ses_child: "ses_mid", ses_mid: "ses_root" })[id]
    expect(rootThread("ses_child", roots, synced, {})?.title).toBe("Migrate the billing webhook")
  })

  test("a subagent known only through the sidebar's session-index links reaches its root", () => {
    const links = { ses_child: "ses_mid", ses_mid: "ses_root" }
    expect(rootThread("ses_child", roots, none, links)?.title).toBe("Migrate the billing webhook")
  })

  test("the store and the links can each hold part of the chain", () => {
    const synced = (id: string) => ({ ses_child: "ses_mid" })[id]
    expect(rootThread("ses_child", roots, synced, { ses_mid: "ses_root" })?.title).toBe("Migrate the billing webhook")
  })

  test("a session with no route to a root, or in a parent cycle, has no owner", () => {
    expect(rootThread("ses_other", roots, none, { ses_child: "ses_root" })).toBeUndefined()
    expect(rootThread("ses_a", roots, none, { ses_a: "ses_b", ses_b: "ses_a" })).toBeUndefined()
  })
})
