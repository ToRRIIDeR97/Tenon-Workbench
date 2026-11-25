import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { sessionNotFoundError } from "@/utils/server-errors"

type LineageStore<T> = { peek: (id: string) => T | undefined; resolve: (id: string) => Promise<unknown> }

type Resolution<T> = { id: string; store: LineageStore<T> } & (
  | { state: "pending" }
  | { state: "settled" }
  | { state: "failed"; failure: unknown }
)

export function createSessionLineage<T>(sessionID: () => string, lineage: () => LineageStore<T>) {
  const cached = createMemo(() => lineage().peek(sessionID()))
  const [status, setStatus] = createSignal<Resolution<T>>()

  createEffect(
    on([sessionID, lineage] as const, ([id, store]) => {
      let stale = false
      onCleanup(() => {
        stale = true
      })
      if (cached()) {
        setStatus({ id, store, state: "settled" })
        return
      }
      setStatus({ id, store, state: "pending" })
      store
        .resolve(id)
        .then(() => {
          if (!stale) setStatus({ id, store, state: "settled" })
        })
        .catch((failure) => {
          if (!stale) setStatus({ id, store, state: "failed", failure })
        })
    }),
  )

  return createMemo(() => {
    const id = sessionID()
    const value = cached()
    if (value) return value
    const state = status()
    if (state?.id !== id || state.store !== lineage()) return undefined
    if (state.state === "failed") throw state.failure
    if (state.state === "settled") throw sessionNotFoundError(id)
    return undefined
  })
}
