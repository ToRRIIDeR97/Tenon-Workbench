import { describe, expect, test } from "bun:test"
import { nextSyncStep, storedThreadView } from "./thread-sync-model"

const thread = {
  sessionID: "ses_1",
  title: "Plan the trip",
  directory: "C:\\Users\\me\\trip",
  head: 4,
  updatedAt: 1_700_000_000_000,
  owner: { id: "laptop-abc123", name: "Laptop" },
  mine: false,
  local: "absent" as const,
  folder: null,
}

describe("AC-P5b-5 stored threads and next step", () => {
  test("a thread owned elsewhere can be continued here and names its computer", () => {
    expect(storedThreadView(thread)).toEqual({
      owner: "Laptop",
      mine: false,
      state: "secondBrain.settings.sync.local.absent",
      canContinue: true,
    })
  })

  test("this computer's thread cannot be continued again", () => {
    const view = storedThreadView({ ...thread, mine: true, local: "current" })
    expect(view.canContinue).toBe(false)
    expect(view.mine).toBe(true)
    expect(view.state).toBe("secondBrain.settings.sync.local.current")
  })

  test("every local state has its own word", () => {
    const states = ["absent", "behind", "current", "ahead", "diverged"] as const
    const words = states.map((local) => storedThreadView({ ...thread, local }).state)
    expect(new Set(words).size).toBe(states.length)
  })

  test("the next step follows client, sign-in, key, then turning sync on", () => {
    const desktop = { secureStorage: true, clientId: null, signedIn: false, signingIn: false, key: false, error: null }
    const server = { ready: false, enabled: false, missing: ["key", "store"] as Array<"key" | "store"> }
    expect(nextSyncStep(desktop, server)).toBe("client")
    expect(nextSyncStep({ ...desktop, clientId: "x.apps.googleusercontent.com" }, server)).toBe("signIn")
    expect(nextSyncStep({ ...desktop, clientId: "x", signedIn: true }, server)).toBe("key")
    expect(nextSyncStep({ ...desktop, clientId: "x", signedIn: true, key: true }, server)).toBe("enable")
    expect(
      nextSyncStep(
        { ...desktop, clientId: "x", signedIn: true, key: true },
        { ready: true, enabled: true, missing: [] },
      ),
    ).toBe("done")
    expect(nextSyncStep({ ...desktop, secureStorage: false }, server)).toBe("secureStorage")
  })
})
