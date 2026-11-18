import { For, Match, Show, Switch, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Harness } from "@tenon/schema/harness"
import { Popover } from "@kobalte/core/popover"
import { Icon } from "@tenon/ui/v2/icon"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { useDialog } from "@tenon/ui/context/dialog"
import { useLanguage } from "@/context/language"
import {
  createHarnessView,
  harnessStatusKey,
  openHarnessSettings,
  type PromptInputHarnessController,
} from "./harness-controls"
import { harnessModelSlot } from "./harness-model-slot"
import { harnessUpdateChoice } from "./harness-update-choice"
import { showToast } from "@/utils/toast"
import { HarnessIcon } from "@/components/harness-icon"
import { filterHarnessModels, searchableModelCount } from "./harness-choice"
import { modelPillLabel, pillEffort } from "./model-pill-label"
import "./model-pill.css"

type Choice = { id: string; label: string }
type Step = "summary" | "harness" | "model" | "effort" | "speed"
type View = "model" | "effort"

/**
 * One pill for what runs the prompt. Its panel is a drill-in stack: a summary row each for harness, model,
 * reasoning and speed (the last two only when the model offers them), and choosing a row slides to that choice's
 * full-width list, so long names never truncate. Picking returns to the summary; the back arrow, Left, Backspace
 * or Esc goes back without picking. The built-in loop picks its model from providers, so its model list offers that
 * picker; its reasoning is the model's variants.
 *
 * When the model offers reasoning levels the pill is two targets in one shape: the logo and model open the stack,
 * and the reasoning level opens just the reasoning list, where a pick applies and closes.
 */
export function PromptModelPill(props: {
  harness: PromptInputHarnessController
  builtIn: boolean
  /**
   * The built-in loop's model name and the action that opens its provider model picker. Home has neither (it
   * has no folder's providers loaded), so there the model is picked once the thread opens.
   */
  builtInModel?: { name: string; choose: () => void }
  /** The built-in loop's reasoning variants, "default" first. */
  builtInVariant?: {
    options: () => string[]
    current: () => string
    set: (value: string) => void
    disabled: () => boolean
  }
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const view = createHarnessView(props.harness)
  const [state, setState] = createStore<{
    open: boolean
    view: View
    step: Step
    motion?: "forward" | "back"
    from?: Step
    query: string
  }>({
    open: false,
    view: "model",
    step: "summary",
    query: "",
  })
  const allModels = () => view.instance()?.models ?? []
  const searchable = () => allModels().length > searchableModelCount
  const models = createMemo(() => filterHarnessModels(allModels(), state.query))
  let panel: HTMLDivElement | undefined
  const defaultLabel = () => language.t("harness.default")

  const efforts = createMemo<Choice[]>(() => {
    if (props.builtIn) {
      const options = props.builtInVariant?.options() ?? []
      return options.length > 1 ? options.map((id) => ({ id, label: id === "default" ? defaultLabel() : id })) : []
    }
    const levels = view.model()?.reasoningEfforts ?? []
    // Default names the level it stands for when the harness reports one, so the list and summary match the pill.
    const resolved = view.model()?.defaultReasoningEffort
    const fallback = resolved
      ? language.t("secondBrain.composer.modelPill.defaultResolved", { level: resolved })
      : defaultLabel()
    return levels.length ? [{ id: "", label: fallback }, ...levels.map((id) => ({ id, label: id }))] : []
  })
  const effort = () =>
    props.builtIn
      ? (props.builtInVariant?.current() ?? "default")
      : (props.harness.model.current()?.reasoningEffort ?? "")
  const tiers = createMemo<Choice[]>(() => {
    if (props.builtIn) return []
    const list = view.model()?.serviceTiers ?? []
    return list.length
      ? [{ id: "", label: defaultLabel() }, ...list.map((tier) => ({ id: tier.id, label: tier.name }))]
      : []
  })
  const tier = () => props.harness.model.current()?.serviceTier ?? ""
  const modelName = () =>
    props.builtIn
      ? (props.builtInModel?.name ?? view.instance()?.name ?? "")
      : (view.model()?.name ?? view.instance()?.name ?? "")

  // Always shown when the model offers levels. On default it is the level default resolves to when the harness
  // reports one (Codex lists `defaultReasoningEffort`), else the word for default: ACP agents and the built-in
  // loop's default variant don't say which level they use.
  const effortLabel = createMemo(() =>
    pillEffort({
      offered: efforts().length > 0,
      current: effort(),
      resolved: props.builtIn ? undefined : view.model()?.defaultReasoningEffort,
      defaultLabel: defaultLabel(),
    }),
  )
  const tierLabel = () => tiers().find((item) => item.id === tier() && item.id)?.label
  // The model part: the model and its speed when that isn't the default. The reasoning part shows the level.
  const modelLabel = createMemo(() => modelPillLabel({ model: modelName(), tier: tierLabel() }))
  const label = createMemo(() => modelPillLabel({ model: modelName(), effort: effortLabel(), tier: tierLabel() }))

  const rows = createMemo(() =>
    (
      [
        { step: "harness", title: language.t("harness.label"), value: view.instance()?.name ?? "" },
        { step: "model", title: language.t("harness.model"), value: modelName() },
        efforts().length > 0 && {
          step: "effort",
          title: language.t("secondBrain.composer.modelPill.reasoning"),
          value: efforts().find((item) => item.id === effort())?.label ?? defaultLabel(),
        },
        tiers().length > 0 && {
          step: "speed",
          title: language.t("secondBrain.composer.modelPill.speed"),
          value: tiers().find((item) => item.id === tier())?.label ?? defaultLabel(),
        },
      ] as const
    ).filter((row): row is Exclude<typeof row, false> => !!row),
  )

  // Focus follows the stack: into a list it lands on the current choice, back out on the row that opened it.
  const focusSoon = (selector: string) =>
    queueMicrotask(() => (panel?.querySelector<HTMLElement>(selector) ?? panel)?.focus({ preventScroll: true }))
  const go = (step: Exclude<Step, "summary">) => {
    setState({ step, motion: "forward", from: step, query: "" })
    // A long model list opens on its search box; typing narrows it and the arrows move into the list.
    focusSoon(step === "model" && searchable() ? "[data-model-search]" : '[aria-checked="true"], [data-row]')
  }
  const back = () => {
    // The reasoning list opened from its own part has no summary to return to.
    if (state.view === "effort") return close()
    const from = state.step
    setState({ step: "summary", motion: "back" })
    focusSoon(`[data-step="${from}"]`)
  }
  // A harness that failed its check because its CLI is behind is updated from its row; the list is asked again
  // once the upgrade lands, so it can be picked without reopening the app (#321).
  const updateChoice = (item: Harness.Instance) =>
    harnessUpdateChoice(item, props.harness.update?.status(item.id), props.harness.update?.running(item.id) ?? false)
  const harnessDetail = (item: Harness.Instance) => {
    const choice = updateChoice(item)
    if (choice?.kind === "update") return language.t("harness.update.row", { latest: choice.latest ?? "" })
    if (choice?.kind === "updating") return language.t("harness.settings.updating")
    if (choice?.kind === "unavailable") return choice.error ?? language.t("harness.unavailable")
    const key = harnessStatusKey(item)
    const update = props.harness.update?.status(item.id)
    if (item.slowStart && update?.updateAvailable)
      return language.t("harness.slowStartUpdate", { latest: update.latest ?? "" })
    return key && language.t(key)
  }
  const slowUpdate = (item: Harness.Instance) => {
    const update = props.harness.update?.status(item.id)
    return item.slowStart && update?.updateAvailable && update.method && !update.manual
      ? (update.latest ?? "")
      : undefined
  }
  const startUpdate = (item: Harness.Instance) =>
    void props.harness.update?.run(item.id).then(
      (result) =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("harness.settings.updated", {
            name: item.name,
            version: result.version ?? "",
          }),
        }),
      (error: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
    )

  const pick = (apply: () => void) => {
    apply()
    back()
  }
  const chooseBuiltInModel = () => {
    close()
    props.builtInModel?.choose()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // In the search box, Backspace and Left edit the text; Esc clears it before it goes back.
    const typing = event.target instanceof HTMLInputElement
    if (typing && ["Backspace", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    if (typing && event.key === "Escape" && state.query) {
      event.preventDefault()
      event.stopPropagation()
      return setState("query", "")
    }
    if (
      state.step !== "summary" &&
      (event.key === "Escape" || event.key === "ArrowLeft" || event.key === "Backspace")
    ) {
      event.preventDefault()
      event.stopPropagation()
      return back()
    }
    if (state.step === "summary" && event.key === "ArrowRight") {
      const step = (document.activeElement as HTMLElement | null)?.dataset.step
      if (step) {
        event.preventDefault()
        return go(step as Exclude<Step, "summary">)
      }
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return
    const items = [...(panel?.querySelectorAll<HTMLElement>("[data-row]:not(:disabled)") ?? [])]
    if (items.length === 0) return
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : at < 0
            ? 0
            : Math.max(0, Math.min(items.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))
    items[next]?.focus()
  }

  // Which part of the pill opened the panel: the model part opens the summary stack, the reasoning part its list.
  const focusView = () => {
    if (state.view === "effort") return focusSoon('[aria-checked="true"], [data-row]')
    // Focus goes to the panel itself, so no row shows a ring until the keyboard moves.
    queueMicrotask(() => panel?.focus({ preventScroll: true }))
  }
  const openPart = (view: View) => {
    if (state.open && state.view === view) return setState("open", false)
    setState({ open: true, view, step: view === "effort" ? "effort" : "summary", motion: undefined, query: "" })
    focusView()
  }
  const close = () => setState("open", false)
  let anchor: HTMLDivElement | undefined
  let modelButton: HTMLButtonElement | undefined
  let effortButton: HTMLButtonElement | undefined
  let pointerOutside = false

  const reasoning = () => effortLabel()
  const partClass =
    "flex h-8 items-center gap-1.5 type-control text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base active:bg-v2-overlay-simple-overlay-pressed data-[open]:bg-v2-overlay-simple-overlay-hover data-[open]:text-v2-text-text-base focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus disabled:text-v2-text-text-disabled disabled:hover:bg-transparent motion-reduce:transition-none"

  return (
    <Popover open={state.open} onOpenChange={(open) => !open && close()} placement="top-start" gutter={6} modal={false}>
      {/* One visual pill, two targets when the model offers reasoning levels; each part highlights on its own. */}
      <Popover.Anchor
        ref={anchor}
        data-component="prompt-model-pill"
        class="flex h-8 min-w-0 max-w-[320px] items-center rounded-full"
      >
        <TooltipV2 placement="top" class="flex min-w-0" value={language.t("secondBrain.composer.modelPill.title")}>
          <button
            ref={modelButton}
            type="button"
            data-action="prompt-model-pill"
            data-open={state.open && state.view === "model" ? "" : undefined}
            disabled={props.harness.disabled?.()}
            aria-haspopup="dialog"
            aria-expanded={state.open && state.view === "model"}
            aria-label={language.t("secondBrain.composer.modelPill.modelPart", {
              model: modelLabel() || language.t("harness.checking"),
            })}
            class={`${partClass} min-w-0 pl-3`}
            classList={{ "rounded-full pr-3": !reasoning(), "rounded-l-full pr-2": !!reasoning() }}
            onClick={() => openPart("model")}
          >
            {/* The harness that runs the model, not the model's maker: DeepSeek on Codex shows Codex. */}
            <HarnessIcon instance={view.instance()} />
            <span class="min-w-0 truncate" title={modelName() !== label() ? label() || undefined : undefined}>
              {modelLabel() || language.t("harness.checking")}
            </span>
            <Show when={!reasoning()}>
              <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            </Show>
          </button>
        </TooltipV2>
        <Show when={reasoning()}>
          {(level) => (
            <>
              <span aria-hidden="true" class="h-4 w-px shrink-0 bg-v2-border-border-muted" />
              <TooltipV2
                placement="top"
                class="flex shrink-0"
                value={language.t("secondBrain.composer.modelPill.reasoning")}
              >
                <button
                  ref={effortButton}
                  type="button"
                  data-action="prompt-model-pill-effort"
                  data-open={state.open && state.view === "effort" ? "" : undefined}
                  disabled={props.harness.disabled?.()}
                  aria-haspopup="dialog"
                  aria-expanded={state.open && state.view === "effort"}
                  aria-label={language.t("secondBrain.composer.modelPill.reasoningPart", { level: level() })}
                  class={`${partClass} shrink-0 rounded-r-full pl-2 pr-3`}
                  onClick={() => openPart("effort")}
                >
                  <span class="capitalize">{level()}</span>
                  <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                </button>
              </TooltipV2>
            </>
          )}
        </Show>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          data-component="popover-content"
          class="w-[clamp(300px,22vw,360px)] max-w-[calc(100vw-32px)] [&_[data-slot=popover-body]]:p-1.5"
          // The pill's own parts open, switch and close the panel; a click on them is not a click outside.
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchor?.contains(event.target)) return event.preventDefault()
            pointerOutside = event.detail.originalEvent.type === "pointerdown"
          }}
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault()
            focusView()
          }}
          // Focus returns to the part that opened the panel, unless the user clicked away.
          onCloseAutoFocus={(event: Event) => {
            event.preventDefault()
            if (!pointerOutside) (state.view === "effort" ? effortButton : modelButton)?.focus({ preventScroll: true })
            pointerOutside = false
          }}
        >
          <div data-slot="popover-body">
            <div
              ref={panel}
              tabIndex={-1}
              data-component="prompt-model-pill-panel"
              class="flex flex-col overflow-hidden text-[13px] outline-none"
              onKeyDown={onKeyDown}
            >
              <Switch>
                <Match when={state.step === "summary"}>
                  <div data-slot="model-pill-step" data-motion={state.motion} class="flex flex-col gap-px">
                    <For each={rows()}>
                      {(row) => (
                        <button
                          type="button"
                          data-row
                          data-step={row.step}
                          class={ROW_CLASS + " min-h-[52px]"}
                          onClick={() => go(row.step as Exclude<Step, "summary">)}
                        >
                          <span class="flex min-w-0 flex-1 flex-col leading-[18px]">
                            <span class="text-[12px] text-v2-text-text-muted">{row.title}</span>
                            <span class="break-words text-[13px] text-v2-text-text-base">{row.value}</span>
                          </span>
                          <Icon name="chevron-down" size="small" class="shrink-0 -rotate-90 text-v2-icon-icon-muted" />
                        </button>
                      )}
                    </For>
                  </div>
                </Match>
                <Match when={state.step !== "summary"}>
                  <div data-slot="model-pill-step" data-motion={state.motion} class="flex flex-col">
                    <div class="mb-1 flex h-10 items-center gap-1.5 border-b border-v2-border-border-muted px-1 type-control text-v2-text-text-base">
                      <Show when={state.view === "model"}>
                        <button
                          type="button"
                          aria-label={language.t("secondBrain.composer.modelPill.back")}
                          class="flex size-8 items-center justify-center rounded-full text-v2-icon-icon-muted transition-colors duration-short ease-standard outline-none hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base active:bg-v2-overlay-simple-overlay-pressed focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
                          onClick={back}
                        >
                          <Icon name="arrow-left" size="small" />
                        </button>
                      </Show>
                      <span class="min-w-0 truncate">{rows().find((row) => row.step === state.step)?.title}</span>
                    </div>
                    <div class="flex max-h-[min(360px,50vh)] min-w-0 flex-col gap-px overflow-y-auto">
                      <Switch>
                        <Match when={state.step === "harness"}>
                          <For each={view.options() ?? []}>
                            {(item) => (
                              <>
                                <Choice
                                  icon={<HarnessIcon instance={item} />}
                                  label={item.name}
                                  detail={harnessDetail(item)}
                                  title={item.error}
                                  selected={item.id === props.harness.current()}
                                  disabled={updateChoice(item)?.disabled ?? item.status === "unavailable"}
                                  onSelect={() =>
                                    updateChoice(item)?.kind === "update"
                                      ? startUpdate(item)
                                      : pick(() => props.harness.select(Harness.InstanceID.make(item.id)))
                                  }
                                />
                                {/* A slow harness without a known update can be checked again from here. */}
                                <Show when={item.slowStart && slowUpdate(item) === undefined}>
                                  <Choice
                                    label={language.t("harness.checkAgain", { name: item.name })}
                                    muted
                                    onSelect={() => props.harness.revalidate?.()}
                                  />
                                </Show>
                                {/* A slow start is often an outdated CLI: the update sits right under it. */}
                                <Show when={slowUpdate(item)}>
                                  {(latest) => (
                                    <Choice
                                      label={language.t("harness.slowStartUpdateRow", {
                                        name: item.name,
                                        latest: latest(),
                                      })}
                                      muted
                                      disabled={props.harness.update?.running(item.id) ?? false}
                                      onSelect={() => startUpdate(item)}
                                    />
                                  )}
                                </Show>
                              </>
                            )}
                          </For>
                          <div class="mx-1.5 my-1 h-px bg-v2-border-border-muted" />
                          <Choice
                            label={language.t("harness.settings.add")}
                            muted
                            onSelect={() => {
                              close()
                              void openHarnessSettings(dialog)
                            }}
                          />
                        </Match>
                        <Match when={state.step === "model" && props.builtIn && props.builtInModel}>
                          {(model) => (
                            <>
                              <Choice label={model().name} selected onSelect={back} />
                              <Choice
                                label={language.t("secondBrain.composer.modelPill.choose")}
                                muted
                                onSelect={chooseBuiltInModel}
                              />
                            </>
                          )}
                        </Match>
                        <Match when={state.step === "model" && props.builtIn}>
                          <p class="px-2.5 py-2 text-[12px] leading-4 text-v2-text-text-muted">
                            {language.t("secondBrain.composer.modelPill.chooseInThread")}
                          </p>
                        </Match>
                        <Match when={state.step === "model"}>
                          <Show
                            when={
                              harnessModelSlot({
                                models: view.instance()?.models.length ?? 0,
                                checking: view.checking(),
                              }) === "select"
                            }
                            fallback={
                              <p class="px-2.5 py-2 text-[12px] leading-4 text-v2-text-text-muted">
                                {view.checking()
                                  ? language.t("harness.models.loading")
                                  : language.t("harness.models.none")}
                              </p>
                            }
                          >
                            <Show when={searchable()}>
                              <input
                                data-model-search
                                type="search"
                                value={state.query}
                                placeholder={language.t("dialog.model.search.placeholder")}
                                aria-label={language.t("dialog.model.search.placeholder")}
                                class="mx-1 mb-1 h-8 shrink-0 rounded-[10px] bg-v2-background-bg-layer-01 px-2.5 text-[13px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-muted focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
                                onInput={(event) => setState("query", event.currentTarget.value)}
                              />
                            </Show>
                            <For each={models()}>
                              {(model) => (
                                <Choice
                                  label={model.name}
                                  selected={model.id === view.model()?.id}
                                  onSelect={() => pick(() => view.selectModel(model.id))}
                                />
                              )}
                            </For>
                            <Show when={models().length === 0}>
                              <p class="px-2.5 py-2 text-[12px] leading-4 text-v2-text-text-muted">
                                {language.t("dialog.model.empty")}
                              </p>
                            </Show>
                          </Show>
                        </Match>
                        <Match when={state.step === "effort"}>
                          <For each={efforts()}>
                            {(choice) => (
                              <Choice
                                label={choice.label}
                                selected={choice.id === effort()}
                                disabled={props.builtIn && !!props.builtInVariant?.disabled()}
                                capitalize
                                onSelect={() =>
                                  pick(() =>
                                    props.builtIn ? props.builtInVariant?.set(choice.id) : view.setEffort(choice.id),
                                  )
                                }
                              />
                            )}
                          </For>
                        </Match>
                        <Match when={state.step === "speed"}>
                          <For each={tiers()}>
                            {(choice) => (
                              <Choice
                                label={choice.label}
                                selected={choice.id === tier()}
                                onSelect={() => pick(() => view.setTier(choice.id))}
                              />
                            )}
                          </For>
                        </Match>
                      </Switch>
                    </div>
                  </div>
                </Match>
              </Switch>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

// Rows show a ring only for keyboard focus; a pointer opening the panel never draws one.
const ROW_CLASS =
  "flex w-full min-w-0 items-center gap-2.5 rounded-[12px] px-2.5 py-1.5 text-left transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus disabled:text-v2-text-text-disabled disabled:hover:bg-transparent disabled:active:bg-transparent motion-reduce:transition-none"

export function Choice(props: {
  /** A leading logo or icon, such as a harness's. */
  icon?: JSX.Element
  label: string
  detail?: string
  title?: string
  selected?: boolean
  disabled?: boolean
  muted?: boolean
  capitalize?: boolean
  onSelect: () => void
}): JSX.Element {
  const row = (
    <button
      type="button"
      data-row
      role="menuitemradio"
      aria-checked={!!props.selected}
      disabled={props.disabled}
      class={ROW_CLASS + " min-h-9"}
      classList={{
        "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container": !!props.selected,
        "text-v2-text-text-muted": !props.selected && props.muted,
        "text-v2-text-text-base": !props.selected && !props.muted,
      }}
      onClick={() => props.onSelect()}
    >
      {props.icon}
      <span class="flex min-w-0 flex-1 flex-col leading-[18px]">
        <span class="break-words" classList={{ capitalize: props.capitalize }}>
          {props.label}
        </span>
        <Show when={props.detail}>
          <span class="text-[12px] leading-4" classList={{ "text-v2-text-text-muted": !props.selected }}>
            {props.detail}
          </span>
        </Show>
      </span>
      <Show when={props.selected}>
        <Icon name="check" size="small" class="shrink-0" />
      </Show>
    </button>
  )

  return (
    <TooltipV2 placement="right" class="w-full min-w-0" inactive={!props.title} value={props.title}>
      {row}
    </TooltipV2>
  )
}
