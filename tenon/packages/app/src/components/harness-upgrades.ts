import type { Harness } from "@tenon/schema/harness"
import { createStore } from "solid-js/store"
import { harnessSettingsChanged } from "@/components/prompt-input/harness-controller"
import { listHarnessUpdates, upgradeHarness, type HarnessServer } from "@/utils/server"

type Deps = {
  upgrade: (id: string) => Promise<Harness.UpdateStatus>
  list: () => Promise<ReadonlyArray<Harness.UpdateStatus>>
  onUpgraded?: (result: Harness.UpdateStatus) => void
}

/**
 * The app's record of harness CLI updates: the statuses the last check returned and each upgrade in flight.
 * Upgrades of different harnesses run side by side (they are separate CLIs); a second start of the same harness,
 * from Settings or from the update toast, joins the one already running (#320).
 */
export function createHarnessUpgrades(deps: Deps) {
  const [state, setState] = createStore<{
    statuses: Record<string, Harness.UpdateStatus>
    running: Record<string, boolean>
  }>({ statuses: {}, running: {} })
  const inflight = new Map<string, Promise<Harness.UpdateStatus>>()
  let checking: Promise<ReadonlyArray<Harness.UpdateStatus>> | undefined

  const store = (items: ReadonlyArray<Harness.UpdateStatus>) => {
    for (const item of items) setState("statuses", item.id, item)
  }

  return {
    status: (id: string): Harness.UpdateStatus | undefined => state.statuses[id],
    running: (id: string) => state.running[id] === true,
    start(id: string) {
      const current = inflight.get(id)
      if (current) return current
      setState("running", id, true)
      const run = deps
        .upgrade(id)
        .then((result) => {
          store([result])
          deps.onUpgraded?.(result)
          return result
        })
        .finally(() => {
          inflight.delete(id)
          setState("running", id, false)
        })
      inflight.set(id, run)
      return run
    },
    check() {
      if (checking) return checking
      const run = deps
        .list()
        .then((items) => {
          store(items)
          return items
        })
        .finally(() => {
          checking = undefined
        })
      checking = run
      return run
    },
  }
}

/** Per-key locks for Settings actions: one action per harness at a time, different harnesses at once. */
export function createActionLocks() {
  const [busy, setBusy] = createStore<Record<string, boolean>>({})
  return {
    busy: (id: string) => busy[id] === true,
    any: () => Object.values(busy).some(Boolean),
    /** Runs `action` unless `id` is busy; returns whether it ran. A failure is the action's to report. */
    run(id: string, action: () => Promise<unknown>) {
      if (busy[id]) return false
      setBusy(id, true)
      const release = () => setBusy(id, false)
      void action().then(release, release)
      return true
    },
  }
}

// One registry per server URL: harness routes are global, so any valid folder serves the request.
const registries = new Map<
  string,
  { target: { server: HarnessServer; directory: string }; upgrades: ReturnType<typeof createHarnessUpgrades> }
>()

/** The shared registry for a server; the latest folder given is the one its requests use. */
export function harnessUpgrades(server: HarnessServer, directory: string) {
  const key = server.server.url
  const existing = registries.get(key)
  if (existing) {
    existing.target = { server, directory }
    return existing.upgrades
  }
  type Entry = NonNullable<ReturnType<typeof registries.get>>
  const entry: Entry = {
    target: { server, directory },
    upgrades: createHarnessUpgrades({
      upgrade: (id) => upgradeHarness(entry.target.server, entry.target.directory, id),
      list: () => listHarnessUpdates(entry.target.server, entry.target.directory),
      // The probe that failed is stale: list the harnesses again so the upgraded one can be picked.
      onUpgraded: () => harnessSettingsChanged(),
    }),
  }
  registries.set(key, entry)
  return entry.upgrades
}
