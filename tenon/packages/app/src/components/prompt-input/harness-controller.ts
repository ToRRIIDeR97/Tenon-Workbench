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
  fallbackUnavailable?: boolean
}

/** The model a harness starts with: its marked default, else its first model. The built-in loop uses the app's own picker. */
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

/**
 * Whether the thread's model should change for the selected harness. The built-in loop clears a harness model.
 * An external harness keeps the current model while its list is empty (still loading, or refreshing) and while a
 * turn runs; it moves to the harness default only when the harness lists models and none is the current one.
 */
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

// Background checks run at most this often; each can start every harness CLI on the server.
const REVALIDATE_MS = 60_000
// Listing Claude Code's models takes about 10s, longer on a cold start.
export const MODEL_RETRY_MS = 3_000
export const MODEL_RETRIES = 10

// Bumped by Settings after a harness is added, toggled, or removed, so open prompts refetch the list.
const [settingsVersion, setSettingsVersion] = createSignal(0)
export const harnessSettingsChanged = () => setSettingsVersion((value) => value + 1)
/** Changes whenever `harnessSettingsChanged` ran; a query keyed on it asks for the harness list again. */
export const harnessSettingsVersion = () => settingsVersion()

/**
 * Where a server's persisted harness list is stored for a folder. The desktop sidecar gets a new port on
 * every launch, so this uses the connection's stable key (as drafts do), not its URL.
 */
export const persistedHarnessKey = (server: ServerConnection.Any, directory: string) =>
  recentHarnessKey(ServerConnection.key(server), directory)

export function createPromptHarnessController(selection: HarnessSelection) {
  const sdk = useSDK()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const server = () => ({ server: serverSDK().server.http, fetch: platform.fetch })
  // The last list each server reported per folder, kept across restarts: after a cold start the picker
  // works from it while the server checks every harness CLI again.
  const [stored, setStored] = persisted(
    Persist.global("harness.instances.v1"),
    createStore<Record<string, ReadonlyArray<Harness.Instance>>>({}),
  )
  // The model last used with each harness, so picking a harness again starts on it rather than its default.
  const [lastModels, setLastModels] = persisted(
    Persist.global("harness.models.v1"),
    createStore<Record<string, Harness.ModelSelection>>({}),
  )
  // A folder without its own list uses the server's list from another folder: availability is the same.
  const storedList = () => {
    const own = stored[persistedHarnessKey(serverSDK().server, sdk().directory)]
    if (own) return own
    const prefix = recentHarnessKey(ServerConnection.key(serverSDK().server), "")
    const key = Object.keys(stored).find((item) => item.startsWith(prefix))
    return key ? stored[key] : undefined
  }
  const modelWindow = createRememberedModelWindow()
  // The model last used with a harness, unless that harness has listed no models for over a minute: then it really
  // has none, and restoring an old one would select a model it no longer offers.
  const rememberedModel = (id: Harness.InstanceID) => (modelWindow.fill(id) ? lastModels[id] : undefined)
  // A list another composer or Home already loaded shows at once; this composer still checks.
  const remembered = rememberedHarnesses(server().server.url, sdk().directory) ?? storedList()
  const [loaded, { refetch }] = createResource(
    () => ({ directory: sdk().directory, version: settingsVersion() }),
    // A first load joins a check already running for the folder and reuses one from the last 30 s, so opening a
    // page again doesn't probe every harness CLI; a refetch (retry, focus, Settings change) always asks.
    ({ directory }, info) =>
      listHarnessesRemembered(
        server(),
        directory,
        (list) =>
          // An agent that answered before listing its models keeps the models it listed last time.
          setStored(
            persistedHarnessKey(serverSDK().server, directory),
            withRememberedModels(list, storedList(), modelWindow.fill) ?? list,
          ),
        { reuse: !info.refetching },
      ),
    // Only a present `initialValue` counts as resolved, so the key is left out when nothing is remembered.
    (remembered ? { initialValue: remembered } : {}) as { initialValue: ReadonlyArray<Harness.Instance> },
  )
  // Never suspend: before the first answer, `latest` reads like `loaded()`, and a suspended read holds
  // the route transition that opened this composer until every harness CLI has answered. `latest`
  // also keeps the last list during a refetch. Desktop storage loads asynchronously, so the persisted list
  // can arrive after the resource started. Models hidden in Settings never reach the picker or the
  // default-model choice.
  const list = () => (loaded.state === "ready" || loaded.state === "refreshing" ? loaded.latest : storedList())
  // A failed check (the server still starting) is retried soon, then every 15 s, until one answers: the picker
  // must never wait for the page to be reopened.
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
  // An agent still starting (or still listing) shows the models it listed last time, so switching to it is
  // instant; its own list replaces them when it arrives. One that still lists none a minute on really has none, and
  // the picker says so (the tick re-reads the list once that minute is up).
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
  // Stale-while-revalidate: the list refreshes when the window regains focus or the picker opens,
  // instead of behind a button. The server reuses recent checks, so most of these are cheap.
  let checked = Date.now()
  const revalidate = () => {
    if (loaded.loading || Date.now() - checked < REVALIDATE_MS) return
    checked = Date.now()
    void refetch()
  }
  window.addEventListener("focus", revalidate)
  onCleanup(() => window.removeEventListener("focus", revalidate))
  const instance = createMemo(() => instances()?.find((item) => item.id === selection.current()))
  // An ACP agent answers before its models are listed (the server reads them in the background),
  // so a harness that is up but has no models yet is asked again a few times.
  const [retry, setRetry] = createStore({ count: 0 })
  // The agent's own answer, before remembered models fill it in: only that says whether its models are in.
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
  // A newly selected harness gets its own full set of model retries.
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
    // Only a confirmed check moves the thread off its harness; a saved list may be out of date.
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
      running: selection.disabled?.() ?? false,
    })
    if ("set" in next) selection.model.set(next.set)
  })

  return {
    instances,
    instance,
    driver: () => instance()?.driver,
    // Only the first load blocks the picker; a stale list stays usable while it refreshes.
    loading: () => loaded.loading && !list(),
    // Any fetch in flight, or a harness that is up but whose models are still being asked for.
    checking: () => loaded.loading || (waitingForModels() && retry.count < MODEL_RETRIES),
    disabled: selection.disabled,
    revalidate,
    current: selection.current,
    select(instanceID: Harness.InstanceID) {
      const next = instances()?.find((item) => item.id === instanceID)
      // No refetch here: listing probes every harness CLI once the server's cache expires. The harness starts on
      // the model last used with it, so a switch back carries on where it left off.
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
