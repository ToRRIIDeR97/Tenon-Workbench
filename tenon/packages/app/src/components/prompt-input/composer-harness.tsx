import { useQuery } from "@tanstack/solid-query"
import { Harness } from "@tenon/schema/harness"
import { createEffect, Show, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { FolderModelPill } from "@/components/prompt-input/folder-model-pill"
import type { PromptInputHarnessController } from "@/components/prompt-input/harness-controls"
import { MODEL_RETRIES, MODEL_RETRY_MS, defaultModel } from "@/components/prompt-input/harness-controller"
import { PromptModelPill } from "@/components/prompt-input/model-pill"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { PromptModel } from "@/context/prompt"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings, withVisibleModels } from "@/context/settings"
import { listHarnessesRemembered, rememberedHarnesses } from "@/utils/server"

export type ComposerHarness = ReturnType<typeof createComposerHarness>

/**
 * The harness, model and reasoning for a composer that starts new threads outside a thread page (Home, the
 * Command Centre). It lists the folder's harnesses, starts on `initial` until the user picks here, falls back to an
 * available harness and keeps the model valid for the selected one. Thread composers use
 * `createPromptHarnessController` instead.
 */
export function createComposerHarness(input: {
  /** Keeps each page's harness list apart in the query cache, e.g. "home" or "command". */
  scope: string
  directory: () => string
  /** The starting choice. Settings load asynchronously on desktop, so it applies until the user picks. */
  initial: () => { harnessID: string; model?: Harness.ModelSelection } | undefined
}) {
  const settings = useSettings()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const [state, setState] = createStore({
    harnessInstanceID: Harness.OpenCode as Harness.InstanceID,
    harnessModel: undefined as Harness.ModelSelection | undefined,
    // The built-in agent's model and reasoning, from the folder's model selection.
    builtInModel: undefined as PromptModel | undefined,
    picked: false,
  })
  createEffect(() => {
    const choice = input.initial()
    if (!choice || state.picked) return
    setState({ harnessInstanceID: Harness.InstanceID.make(choice.harnessID), harnessModel: choice.model })
  })

  const query = useQuery(() => ({
    queryKey: [input.scope, "harnesses", server.key, input.directory()],
    enabled: !!input.directory(),
    queryFn: () =>
      listHarnessesRemembered({ server: serverSDK().server.http, fetch: platform.fetch }, input.directory()),
    // After the cached query is collected, the last good list keeps the picker usable while it reloads.
    placeholderData: () => rememberedHarnesses(serverSDK().server.http.url, input.directory()),
    staleTime: 30_000,
    refetchOnMount: true,
    // A check that fails before anything is remembered (the server still starting) is retried soon.
    retry: MODEL_RETRIES,
    retryDelay: MODEL_RETRY_MS,
    // The selected agent can answer before its models are listed; ask again until they arrive, as threads do.
    refetchInterval: (current) => {
      const selected = current.state.data?.find((item) => item.id === state.harnessInstanceID)
      const waiting =
        selected?.driver !== Harness.OpenCodeDriver && selected?.status === "available" && selected.models.length === 0
      return waiting && current.state.dataUpdateCount <= MODEL_RETRIES ? MODEL_RETRY_MS : false
    },
  }))
  // Models hidden in Settings never reach the picker or the default-model choice, as in the thread composer.
  // Reading `data` suspends, so callers outside the pill's Suspense boundary check `isPending` first.
  const instances = () =>
    query.data?.map((item) =>
      withVisibleModels(item, settings.harnesses.hiddenModels(item.id), settings.harnesses.hiddenProviders(item.id)),
    )
  // Fall back to an available harness, and keep the model valid for the selected one.
  createEffect(() => {
    if (query.isPending) return
    const available = instances()
    if (!available) return
    const current = available.find((instance) => instance.id === state.harnessInstanceID)
    if (current?.status !== "available") {
      // Only a confirmed check moves off the harness; a remembered list may be out of date.
      if (query.isPlaceholderData) return
      const fallback = available.find((instance) => instance.status === "available")
      if (fallback) setState({ harnessInstanceID: fallback.id, harnessModel: defaultModel(fallback) })
      return
    }
    if (current.models.some((model) => model.id === state.harnessModel?.id)) return
    setState("harnessModel", defaultModel(current))
  })

  const controller: PromptInputHarnessController = {
    instances,
    // Only the first load blocks the picker; a stale list stays usable while it refreshes.
    loading: () => query.isPending,
    // Opening the picker refetches once stale; the app's queries don't refetch on window focus.
    revalidate: () => void (query.isStale && query.refetch()),
    current: () => state.harnessInstanceID,
    select: (instanceID) => {
      const next = instances()?.find((instance) => instance.id === instanceID)
      setState({ harnessInstanceID: instanceID, harnessModel: next ? defaultModel(next) : undefined, picked: true })
    },
    model: {
      current: () => state.harnessModel,
      set: (model) => setState("harnessModel", model),
    },
  }

  // The built-in agent needs no check, so only another harness waits for the list. The thread page
  // sends once its own list has loaded, and keeps the prompt if the harness turns out unavailable.
  const builtIn = () =>
    (instances()?.find((item) => item.id === state.harnessInstanceID)?.driver ??
      (state.harnessInstanceID === Harness.OpenCode ? Harness.OpenCodeDriver : undefined)) === Harness.OpenCodeDriver

  return {
    controller,
    directory: input.directory,
    builtIn,
    /** A harness other than the built-in agent whose list is still loading: sending waits. */
    waiting: () => query.isPending && state.harnessInstanceID !== Harness.OpenCode,
    harnessID: () => state.harnessInstanceID,
    harnessModel: () => state.harnessModel,
    /** The built-in agent's model and reasoning; undefined for another harness. */
    builtInModel: () => (builtIn() ? state.builtInModel : undefined),
    setBuiltInModel: (model: PromptModel | undefined) => setState("builtInModel", model),
  }
}

/** The model pill for a `createComposerHarness` composer, for its `controls` slot. */
export function ComposerModelPill(props: { harness: ComposerHarness }) {
  const language = useLanguage()
  return (
    // The harness query suspends while it loads; this boundary keeps the rest of the page on screen.
    <Suspense
      fallback={
        <span class="flex h-8 items-center px-3 type-control text-v2-text-text-muted">
          {language.t("harness.checking")}
        </span>
      }
    >
      <Show
        when={props.harness.directory()}
        keyed
        fallback={<PromptModelPill harness={props.harness.controller} builtIn={props.harness.builtIn()} />}
      >
        {(folder) => (
          <FolderModelPill
            directory={folder}
            harness={props.harness.controller}
            builtIn={props.harness.builtIn()}
            onModel={props.harness.setBuiltInModel}
          />
        )}
      </Show>
    </Suspense>
  )
}
