import { describe, expect, test } from "bun:test"
import type { Harness } from "@tenon/schema/harness"
import { createActionLocks, createHarnessUpgrades } from "./harness-upgrades"

const status = (id: string, version = "2.0.0"): Harness.UpdateStatus =>
  ({ id, name: id, version, latest: version, updateAvailable: false }) as unknown as Harness.UpdateStatus

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

describe("AC-1 harness upgrades run per harness", () => {
  test("two different harnesses upgrade at the same time", async () => {
    const started: string[] = []
    const pending = new Map<string, ReturnType<typeof deferred<Harness.UpdateStatus>>>()
    const upgrades = createHarnessUpgrades({
      upgrade: (id) => {
        started.push(id)
        const next = deferred<Harness.UpdateStatus>()
        pending.set(id, next)
        return next.promise
      },
      list: async () => [],
    })
    const codex = upgrades.start("codex")
    const claude = upgrades.start("claude-code")
    expect(started).toEqual(["codex", "claude-code"])
    expect(upgrades.running("codex")).toBe(true)
    expect(upgrades.running("claude-code")).toBe(true)
    pending.get("claude-code")!.resolve(status("claude-code"))
    await claude
    expect(upgrades.running("claude-code")).toBe(false)
    expect(upgrades.running("codex")).toBe(true)
    pending.get("codex")!.resolve(status("codex"))
    expect(String((await codex).id)).toBe("codex")
    expect(upgrades.running("codex")).toBe(false)
  })

  test("a second start of the same harness joins the first instead of running twice", async () => {
    let calls = 0
    const next = deferred<Harness.UpdateStatus>()
    const upgrades = createHarnessUpgrades({
      upgrade: () => {
        calls += 1
        return next.promise
      },
      list: async () => [],
    })
    const first = upgrades.start("codex")
    const second = upgrades.start("codex")
    expect(calls).toBe(1)
    expect(second).toBe(first)
    next.resolve(status("codex"))
    await first
    expect(calls).toBe(1)
  })

  test("a failed upgrade clears its running state and rejects", async () => {
    const upgrades = createHarnessUpgrades({
      upgrade: () => Promise.reject(new Error("npm failed")),
      list: async () => [],
    })
    await expect(upgrades.start("codex")).rejects.toThrow("npm failed")
    expect(upgrades.running("codex")).toBe(false)
  })

  test("a finished upgrade records the new status and reports it", async () => {
    const done: string[] = []
    const upgrades = createHarnessUpgrades({
      upgrade: async (id) => status(id, "3.1.0"),
      list: async () => [],
      onUpgraded: (result) => done.push(`${result.id}@${result.version}`),
    })
    await upgrades.start("codex")
    expect(upgrades.status("codex")?.version).toBe("3.1.0")
    expect(done).toEqual(["codex@3.1.0"])
  })

  test("update checks share one request while it runs and store every status", async () => {
    let calls = 0
    const next = deferred<Harness.UpdateStatus[]>()
    const upgrades = createHarnessUpgrades({
      upgrade: async (id) => status(id),
      list: () => {
        calls += 1
        return next.promise
      },
    })
    const a = upgrades.check()
    const b = upgrades.check()
    expect(calls).toBe(1)
    next.resolve([status("codex", "1.0.0"), status("gemini", "0.9.0")])
    await Promise.all([a, b])
    expect(upgrades.status("gemini")?.version).toBe("0.9.0")
    await upgrades.check()
    expect(calls).toBe(2)
  })
})

describe("AC-1 Settings actions lock per harness", () => {
  test("a busy harness refuses another action; a different harness runs", async () => {
    const locks = createActionLocks()
    const first = deferred<void>()
    expect(locks.run("codex", () => first.promise)).toBe(true)
    expect(locks.busy("codex")).toBe(true)
    expect(locks.run("codex", async () => undefined)).toBe(false)
    expect(locks.run("claude-code", async () => undefined)).toBe(true)
    expect(locks.busy("claude-code")).toBe(true)
    expect(locks.any()).toBe(true)
    first.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(locks.busy("codex")).toBe(false)
  })

  test("a failed action still releases its lock", async () => {
    const locks = createActionLocks()
    let release!: () => void
    const settled = new Promise<void>((resolve) => (release = resolve))
    locks.run("codex", () => Promise.reject(new Error("no")).finally(() => queueMicrotask(release)))
    await settled
    await Promise.resolve()
    expect(locks.busy("codex")).toBe(false)
    expect(locks.any()).toBe(false)
  })
})
