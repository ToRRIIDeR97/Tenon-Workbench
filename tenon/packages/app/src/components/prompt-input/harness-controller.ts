import { createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Harness } from "@tenon/schema/harness"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings, withVisibleModels } from "@/context/settings"
import { Persist, persisted } from "@/utils/persist"
import { ServerConnection } from "@/context/server"
import { listHarnessesRemembered, recentHarnessKey, rememberedHarnesses } from "@/utils/server"
import { harnessUpgrades } from "@/components/harness-upgrades"
import { shouldCheckHarnessUpdates } from "./harness-update-choice"
import type { PromptInputHarnessController } from "./harness-controls"
import {
  createRememberedModelWindow,
  harnessModelFor,
  harnessRetryDelay,
  REMEMBERED_MODELS_MS,
  withRememberedModels,
} from "./harness-memory"

type HarnessSelection = {
  current: () => Harness.InstanceID
  set: (instanceID: Harness.InstanceID, model?: Harness.ModelSelection) => void
  model: PromptInputHarnessController["model"]
  disabled?: () => boolean
  harnessLocked?: () => boolean
  fallbackUnavailable?: boolean
}

export const defaultModel = (instance: Harness.Instance) => {
  if (instance.driver === Harness.OpenCodeDriver) return
  const model = instance.models.find((item) => item.isDefault) ?? instance.models[0]
  return model
    ? {
        id: model.id,
        reasoningEffort: model.defaultReasoningEffort,
        serviceTier: model.defaultServiceTier,
      }
    : undefined
}

export function reconcileHarnessModel(input: {
  selected: Harness.Instance
  current: { id: string } | undefined
  running: boolean
}): { keep: true } | { set: ReturnType<typeof defaultModel> } {
  if (input.selected.driver === Harness.OpenCodeDriver) return input.current ? { set: undefined } : { keep: true }
  if (input.running || input.selected.models.length === 0) return { keep: true }
  if (input.selected.models.some((model) => model.id === input.current?.id)) return { keep: true }
  return { set: defaultModel(input.selected) }
}

const REVALIDATE_MS = 60_000
export const MODEL_RETRY_MS = 3_000
export const MODEL_RETRIES = 10

const [settingsVersion, setSettingsVersion] = createSignal(0)
export const harnessSettingsChanged = () => setSettingsVersion((value) => value + 1)
export const harnessSettingsVersion = () => settingsVersion()

let lastUpdateCheck: number | undefined

export const persistedHarnessKey = (server: ServerConnection.Any, directory: string) =>
  recentHarnessKey(ServerConnection.key(server), directory)

export function createPromptHarnessController(selection: HarnessSelection) {
  const sdk = useSDK()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const server = () => ({ server: serverSDK().server.http, fetch: platform.fetch })
  const [stored, setStored] = persisted(
    Persist.global("harness.instances.v1"),
    createStore<Record<string, ReadonlyArray<Harness.Instance>>>({}),
  )
  const [lastModels, setLastModels] = persisted(
    Persist.global("harness.models.v1"),
    createStore<Record<string, Harness.ModelSelection>>({}),
  )
  const storedList = () => {
    const own = stored[persistedHarnessKey(serverSDK().server, sdk().directory)]
    if (own) return own
    const prefix = recentHarnessKey(ServerConnection.key(serverSDK().server), "")
    const key = Object.keys(stored).find((item) => item.startsWith(prefix))
    return key ? stored[key] : undefined
  }
  const modelWindow = createRememberedModelWindow()
  const rememberedModel = (id: Harness.InstanceID) => (modelWindow.fill(id) ? lastModels[id] : undefined)
  const remembered = rememberedHarnesses(server().server.url, sdk().directory) ?? storedList()
  const [loaded, { refetch }] = createResource(
    () => ({ directory: sdk().directory, version: settingsVersion() }),
    ({ directory }, info) =>
      listHarnessesRemembered(
        server(),
        directory,
        (list) =>
          setStored(
            persistedHarnessKey(serverSDK().server, directory),
            withRememberedModels(list, storedList(), modelWindow.fill) ?? list,
          ),
        { reuse: !info.refetching },
      ),
    (remembered ? { initialValue: remembered } : {}) as { initialValue: ReadonlyArray<Harness.Instance> },
  )
  const list = () => (loaded.state === "ready" || loaded.state === "refreshing" ? loaded.latest : storedList())
  const [failures, setFailures] = createSignal(0)
  createEffect(() => {
    if (loaded.state !== "errored") return
    const timer = setTimeout(() => {
      setFailures((count) => count + 1)
      void refetch()
    }, harnessRetryDelay(failures()))
    onCleanup(() => clearTimeout(timer))
  })
  createEffect(() => {
    if (loaded.state === "ready") setFailures(0)
  })
  const [expired, setExpired] = createSignal(0)
  createEffect(
    on(list, () => {
      const timer = setTimeout(() => setExpired((value) => value + 1), REMEMBERED_MODELS_MS + 100)
      onCleanup(() => clearTimeout(timer))
    }),
  )
  const instances = createMemo(() => {
    expired()
    const current = list()
    modelWindow.observe(current)
    return withRememberedModels(current, storedList(), modelWindow.fill)?.map((item) =>
      withVisibleModels(item, settings.harnesses.hiddenModels(item.id), settings.harnesses.hiddenProviders(item.id)),
    )
  })
  let checked = Date.now()
  const revalidate = () => {
    if (loaded.loading || Date.now() - checked < REVALIDATE_MS) return
    checked = Date.now()
    void refetch()
  }
  window.addEventListener("focus", revalidate)
  onCleanup(() => window.removeEventListener("focus", revalidate))
  const instance = createMemo(() => instances()?.find((item) => item.id === selection.current()))
  const upgrades = () => harnessUpgrades(server(), sdk().directory)
  createEffect(() => {
    const now = Date.now()
    if (!shouldCheckHarnessUpdates(instances(), lastUpdateCheck, now)) return
    lastUpdateCheck = now
    void upgrades()
      .check()
      .catch(() => undefined)
  })
  const [retry, setRetry] = createStore({ count: 0 })
  const reported = () => list()?.find((item) => item.id === selection.current())
  const waitingForModels = () => {
    const current = reported()
    return (
      !!current &&
      current.driver !== Harness.OpenCodeDriver &&
      current.status === "available" &&
      current.models.length === 0
    )
  }
  createEffect(on(selection.current, () => setRetry("count", 0), { defer: true }))
  createEffect(() => {
    const current = reported()
    if (!current || current.driver === Harness.OpenCodeDriver || current.status !== "available") return
    if (current.models.length > 0) {
      setRetry("count", 0)
      return
    }
    if (loaded.loading || retry.count >= MODEL_RETRIES) return
    const timer = setTimeout(() => {
      void refetch()
      setRetry("count", (count) => count + 1)
    }, MODEL_RETRY_MS)
    onCleanup(() => clearTimeout(timer))
  })

  createEffect(() => {
    const available = instances()
    if (!available) return
    const current = available.find((item) => item.id === selection.current())
    if (current?.status !== "available" && loaded.state !== "ready") return
    const selected =
      current?.status === "available"
        ? current
        : selection.fallbackUnavailable === false
          ? undefined
          : available.find((item) => item.status === "available")
    if (!selected) return
    if (selected.id !== selection.current()) {
      selection.set(selected.id, harnessModelFor(selected, rememberedModel(selected.id)))
      return
    }
    const next = reconcileHarnessModel({
      selected,
      current: selection.model.current(),
      running: (selection.harnessLocked ?? selection.disabled)?.() ?? false,
    })
    if ("set" in next) selection.model.set(next.set)
  })

  return {
    instances,
    instance,
    driver: () => instance()?.driver,
    loading: () => loaded.loading && !list(),
    checking: () => loaded.loading || (waitingForModels() && retry.count < MODEL_RETRIES),
    disabled: selection.disabled,
    harnessLocked: selection.harnessLocked,
    revalidate,
    update: {
      status: (id: string) => upgrades().status(id),
      running: (id: string) => upgrades().running(id),
      run: (id: string) => upgrades().start(id),
    },
    current: selection.current,
    select(instanceID: Harness.InstanceID) {
      const next = instances()?.find((item) => item.id === instanceID)
      selection.set(instanceID, next ? harnessModelFor(next, rememberedModel(instanceID)) : rememberedModel(instanceID))
    },
    model: {
      current: selection.model.current,
      set(model) {
        if (model) setLastModels(selection.current(), { ...model })
        selection.model.set(model)
      },
    },
  } satisfies PromptInputHarnessController & {
    instance: () => Harness.Instance | undefined
    driver: () => Harness.DriverKind | undefined
  }
}
