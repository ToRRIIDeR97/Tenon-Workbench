import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionLineage } from "@/pages/session/session-lineage"

type Lineage = { session: { id: string; directory: string } }

const lineageOf = (id: string): Lineage => ({ session: { id, directory: `/dir/${id}` } })

function createFixture(initial: Record<string, Lineage> = {}) {
  const [cache, setCache] = createSignal(initial)
  const deferred = new Map<string, PromiseWithResolvers<unknown>>()
  const resolves: string[] = []
  return {
    resolves,
    lineage: {
      peek: (id: string) => cache()[id],
      resolve: (id: string) => {
        resolves.push(id)
        const entry = deferred.get(id) ?? Promise.withResolvers<unknown>()
        deferred.set(id, entry)
        return entry.promise
      },
    },
    settle(id: string) {
      setCache({ ...cache(), [id]: lineageOf(id) })
      deferred.get(id)?.resolve(undefined)
    },
    fail(id: string, error: unknown) {
      deferred.get(id)?.reject(error)
      deferred.delete(id)
    },
    remove(id: string) {
      const next = { ...cache() }
      delete next[id]
      setCache(next)
    },
  }
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

test("resolves an uncached session and exposes its lineage", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const current = createSessionLineage(
      () => "ses_a",
      () => fixture.lineage,
    )

    expect(current()).toBeUndefined()
    await flush()
    expect(fixture.resolves).toEqual(["ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    dispose()
  })
})

test("re-resolves when navigating to an uncached session without a remount", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture({ ses_a: lineageOf("ses_a") })
    const [id, setId] = createSignal("ses_a")
    const current = createSessionLineage(id, () => fixture.lineage)

    await flush()
    expect(current()?.session.id).toBe("ses_a")

    expect(() => {
      setId("ses_b")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_b"])

    fixture.settle("ses_b")
    await flush()
    expect(current()?.session.id).toBe("ses_b")

    dispose()
  })
})

test("ignores a stale resolution failure after the target changes", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionLineage(id, () => fixture.lineage)

    await flush()
    setId("ses_b")
    fixture.fail("ses_a", new Error("Session not found: ses_a"))
    await flush()

    expect(() => current()).not.toThrow()
    fixture.settle("ses_b")
    await flush()
    expect(current()?.session.id).toBe("ses_b")

    dispose()
  })
})

test("returning to a pruned session re-resolves instead of throwing not found", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionLineage(id, () => fixture.lineage)

    await flush()
    fixture.settle("ses_a")
    await flush()

    setId("ses_b")
    fixture.settle("ses_b")
    await flush()

    fixture.remove("ses_a")
    expect(() => {
      setId("ses_a")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_a", "ses_b", "ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    dispose()
  })
})

test("revisiting a session whose resolution failed while unfocused retries cleanly", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionLineage(id, () => fixture.lineage)

    await flush()
    setId("ses_b")
    fixture.fail("ses_a", new Error("resolve failed"))
    await flush()

    expect(() => {
      setId("ses_a")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_a", "ses_b", "ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    dispose()
  })
})

test("re-resolves against a replaced lineage store", async () => {
  await createRoot(async (dispose) => {
    const first = createFixture()
    const second = createFixture()
    const [store, setStore] = createSignal(first.lineage)
    const current = createSessionLineage(() => "ses_a", store)

    await flush()
    first.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    expect(() => {
      setStore(second.lineage)
      current()
    }).not.toThrow()
    await flush()
    expect(second.resolves).toEqual(["ses_a"])

    second.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    dispose()
  })
})

test("throws not found when the settled session is deleted", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const current = createSessionLineage(
      () => "ses_a",
      () => fixture.lineage,
    )

    await flush()
    fixture.settle("ses_a")
    await flush()
    expect(current()?.session.id).toBe("ses_a")

    expect(() => {
      fixture.remove("ses_a")
      current()
    }).toThrow("Session not found: ses_a")

    dispose()
  })
})
