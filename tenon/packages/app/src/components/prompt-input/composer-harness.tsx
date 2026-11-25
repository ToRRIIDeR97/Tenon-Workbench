import { useQuery } from "@tanstack/solid-query"
import { Harness } from "@tenon/schema/harness"
import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { FolderModelPill } from "@/components/prompt-input/folder-model-pill"
import type { PromptInputHarnessController } from "@/components/prompt-input/harness-controls"
import { MODEL_RETRIES, MODEL_RETRY_MS, defaultModel } from "@/components/prompt-input/harness-controller"
import { harnessRetryDelay, withRememberedModels } from "@/components/prompt-input/harness-memory"
import { PromptModelPill } from "@/components/prompt-input/model-pill"
import { rememberingHarness } from "@/components/prompt-input/harness-choice"
import { usePlatform } from "@/context/platform"
import type { PromptModel } from "@/context/prompt"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings, withVisibleModels } from "@/context/settings"
import { listHarnessesRemembered, rememberedHarnesses } from "@/utils/server"

export type ComposerHarness = ReturnType<typeof createComposerHarness>

export function createComposerHarness(input: {
  scope: string
  directory: () => string
  initial: () => { harnessID: string; model?: Harness.ModelSelection } | undefined
}) {
  const settings = useSettings()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const [state, setState] = createStore({
    harnessInstanceID: Harness.OpenCode as Harness.InstanceID,
    harnessModel: undefined as Harness.ModelSelection | undefined,
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
    placeholderData: () => rememberedHarnesses(serverSDK().server.http.url, input.directory()),
    staleTime: 30_000,
    refetchOnMount: true,
    retry: true,
    retryDelay: (failures) => harnessRetryDelay(failures),
    refetchInterval: (current) => {
      const selected = current.state.data?.find((item) => item.id === state.harnessInstanceID)
      const waiting =
        selected?.driver !== Harness.OpenCodeDriver && selected?.status === "available" && selected.models.length === 0
      return waiting && current.state.dataUpdateCount <= MODEL_RETRIES ? MODEL_RETRY_MS : false
    },
  }))
  const remembered = () => rememberedHarnesses(serverSDK().server.http.url, input.directory())
  const instances = () =>
    withRememberedModels(query.isPending ? remembered() : query.data, remembered())?.map((item) =>
      withVisibleModels(item, settings.harnesses.hiddenModels(item.id), settings.harnesses.hiddenProviders(item.id)),
    )
  createEffect(() => {
    if (query.isPending) return
    const available = instances()
    if (!available) return
    const current = available.find((instance) => instance.id === state.harnessInstanceID)
    if (current?.status !== "available") {
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
    loading: () => query.isPending && !remembered(),
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

  const builtIn = () =>
    (instances()?.find((item) => item.id === state.harnessInstanceID)?.driver ??
      (state.harnessInstanceID === Harness.OpenCode ? Harness.OpenCodeDriver : undefined)) === Harness.OpenCodeDriver

  return {
    controller,
    directory: input.directory,
    builtIn,
    waiting: () => query.isPending && state.harnessInstanceID !== Harness.OpenCode,
    harnessID: () => state.harnessInstanceID,
    harnessModel: () => state.harnessModel,
    builtInModel: () => (builtIn() ? state.builtInModel : undefined),
    setBuiltInModel: (model: PromptModel | undefined) => setState("builtInModel", model),
  }
}

export function ComposerModelPill(props: { harness: ComposerHarness }) {
  const settings = useSettings()
  const controller = rememberingHarness(props.harness.controller, settings.harnesses.setLastUsed)
  return (
    <Show
      when={props.harness.directory()}
      keyed
      fallback={<PromptModelPill harness={controller} builtIn={props.harness.builtIn()} />}
    >
      {(folder) => (
        <FolderModelPill
          directory={folder}
          harness={controller}
          builtIn={props.harness.builtIn()}
          onModel={props.harness.setBuiltInModel}
        />
      )}
    </Show>
  )
}
