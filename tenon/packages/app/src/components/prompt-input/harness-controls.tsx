import { Show, createMemo } from "solid-js"
import { Harness } from "@tenon/schema/harness"
import { PromptInputV2Select } from "@tenon/session-ui/v2/prompt-input"
import { Icon } from "@tenon/ui/v2/icon"
import { useDialog } from "@tenon/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { harnessModelSlot } from "./harness-model-slot"
import { HarnessIcon } from "@/components/harness-icon"

export type PromptInputHarnessController = {
  instances: () => ReadonlyArray<Harness.Instance> | undefined
  loading: () => boolean
  checking?: () => boolean
  disabled?: () => boolean
  harnessLocked?: () => boolean
  revalidate?: () => void
  current: () => Harness.InstanceID
  select: (instanceID: Harness.InstanceID) => void
  update?: {
    status: (id: string) => Harness.UpdateStatus | undefined
    running: (id: string) => boolean
    run: (id: string) => Promise<Harness.UpdateStatus>
  }
  model: {
    current: () => Harness.ModelSelection | undefined
    set: (model: Harness.ModelSelection | undefined) => void
  }
}

export function orderHarnesses(instances: ReadonlyArray<Harness.Instance> | undefined) {
  return instances?.toSorted((a, b) => Number(isExternalHarness(a)) - Number(isExternalHarness(b)))
}

export function harnessStatusKey(
  instance: Pick<Harness.Instance, "driver" | "status" | "authenticated" | "slowStart">,
) {
  if (instance.status === "unavailable") return "harness.unavailable"
  if (instance.slowStart) return "harness.slowStart"
  if (instance.driver === Harness.AcpDriver && instance.authenticated === false) return "harness.signInNotFound"
  return undefined
}

export function isExternalHarness(instance: Pick<Harness.Instance, "driver">) {
  return instance.driver !== Harness.OpenCodeDriver
}

export async function openHarnessSettings(dialog: ReturnType<typeof useDialog>) {
  const { DialogSettings } = await import("@/components/settings-v2/dialog-settings-v2")
  void dialog.show(() => <DialogSettings defaultValue="harnesses" />)
}

const SELECT_CLASS =
  "prompt-input-responsive-select !h-8 !w-auto min-w-0 max-w-[220px] !bg-transparent !shadow-none hover:!bg-v2-overlay-simple-overlay-hover"

export function createHarnessView(controller: PromptInputHarnessController) {
  const options = createMemo(() => orderHarnesses(controller.instances()))
  const checking = () => controller.loading() || !!controller.checking?.()
  const instance = createMemo<Harness.Instance | undefined>((previous) => {
    const next = controller.instances()?.find((item) => item.id === controller.current())
    const kept = previous?.id === controller.current() && previous.models.length > 0 ? previous : undefined
    if (!next) return checking() ? kept : undefined
    if (next.models.length === 0 && checking()) return kept ?? next
    return next
  })
  const model = createMemo(() => {
    const selection = controller.model.current()
    const models = instance()?.models
    return selection ? models?.find((item) => item.id === selection.id) : models?.[0]
  })
  const selectModel = (id: string) => {
    const selected = instance()?.models.find((item) => item.id === id)
    if (!selected) return
    controller.model.set({
      id: selected.id,
      reasoningEffort: selected.defaultReasoningEffort,
      serviceTier: selected.defaultServiceTier,
    })
  }
  const setEffort = (reasoningEffort: string) => {
    const selected = model()
    if (!selected) return
    const current = controller.model.current() ?? { id: selected.id }
    controller.model.set({ ...current, reasoningEffort: reasoningEffort || undefined })
  }
  const setTier = (serviceTier: string) => {
    const selected = model()
    if (!selected) return
    const current = controller.model.current() ?? { id: selected.id }
    controller.model.set({ ...current, serviceTier: serviceTier || undefined })
  }
  return { options, checking, instance, model, selectModel, setEffort, setTier }
}

export function PromptInputHarnessControls(props: { controller: PromptInputHarnessController }) {
  const language = useLanguage()
  const dialog = useDialog()
  const addHarness = () => openHarnessSettings(dialog)
  const { options, checking, instance, model, selectModel, setEffort, setTier } = createHarnessView(props.controller)

  return (
    <>
      <PromptInputV2Select
        title={language.t("harness.label")}
        options={
          options()?.map((item) => ({
            id: item.id,
            label: item.name + (harnessStatusKey(item) ? ` - ${language.t(harnessStatusKey(item)!)}` : ""),
            disabled: item.status === "unavailable",
            title: item.error,
            group: isExternalHarness(item) ? language.t("harness.group.external") : undefined,
          })) ?? [{ id: props.controller.current(), label: language.t("harness.checking") }]
        }
        footer={{ label: language.t("harness.settings.add"), onSelect: () => void addHarness() }}
        current={props.controller.current()}
        control="harness"
        currentIcon={<Icon name="harness" />}
        class={SELECT_CLASS}
        disabled={props.controller.loading() || props.controller.disabled?.() || !props.controller.instances()}
        onOpenChange={(open) => open && props.controller.revalidate?.()}
        onSelect={(id) => props.controller.select(Harness.InstanceID.make(id))}
      />
      <Show when={instance()?.driver !== Harness.OpenCodeDriver && instance()}>
        {(item) => (
          <Show
            when={harnessModelSlot({ models: item().models.length, checking: checking() }) === "select"}
            fallback={
              <span class="px-2 text-[12px] text-v2-text-text-muted">
                {harnessModelSlot({ models: 0, checking: checking() }) === "loading"
                  ? language.t("harness.models.loading")
                  : language.t("harness.models.none")}
              </span>
            }
          >
            <PromptInputV2Select
              title={language.t("harness.model")}
              options={item().models.map((option) => ({ id: option.id, label: option.name }))}
              current={props.controller.model.current()?.id ?? item().models[0]?.id ?? ""}
              control="harness-model"
              currentIcon={<HarnessIcon instance={item()} />}
              class={SELECT_CLASS}
              capitalize={false}
              disabled={props.controller.disabled?.()}
              onSelect={selectModel}
            />
          </Show>
        )}
      </Show>
      <Show when={model()}>
        {(selected) => (
          <>
            <Show when={selected().reasoningEfforts.length > 0}>
              <PromptInputV2Select
                title={language.t("harness.effort")}
                options={[
                  { id: "", label: language.t("harness.default") },
                  ...selected().reasoningEfforts.map((effort) => ({ id: effort, label: effort })),
                ]}
                current={props.controller.model.current()?.reasoningEffort ?? ""}
                control="harness-effort"
                currentIcon={<Icon name="settings-gear" />}
                class={SELECT_CLASS}
                capitalize={false}
                disabled={props.controller.disabled?.()}
                onSelect={setEffort}
              />
            </Show>
            <Show when={selected().serviceTiers.length > 0}>
              <PromptInputV2Select
                title={language.t("harness.serviceTier")}
                options={[
                  { id: "", label: language.t("harness.default") },
                  ...selected().serviceTiers.map((tier) => ({ id: tier.id, label: tier.name })),
                ]}
                current={props.controller.model.current()?.serviceTier ?? ""}
                control="harness-service-tier"
                currentIcon={<Icon name="outline-sliders" />}
                class={SELECT_CLASS}
                capitalize={false}
                disabled={props.controller.disabled?.()}
                onSelect={setTier}
              />
            </Show>
          </>
        )}
      </Show>
    </>
  )
}
