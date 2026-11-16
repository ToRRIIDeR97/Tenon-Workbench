import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import {
  DESIGN_SANDBOX,
  designDocument,
  designTooLarge,
  type CanvasDesign,
  type Design,
} from "@tenon/session-ui/design-fence"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { ViewSwitch } from "@tenon/ui/v2/view-switch"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useDesignCanvas } from "@/pages/session/design-canvas"
import { LiveDesignFrame } from "@/pages/session/live-design-frame"

// Previews lay a design out at a desktop width, then scale it down to the card.
const ARTBOARD_WIDTH = 1280
const ARTBOARD_HEIGHT = 800

/** The Canvas tab: the thread's designs as a grid of artboards, or one of them shown large. */
export function SessionCanvasTab() {
  const canvas = useDesignCanvas()
  const language = useLanguage()
  const byKey = createMemo(() => new Map(canvas.designs().map((design) => [design.key, design])))
  // Keys, not designs, drive the views: a streamed token or a closing fence keeps every card and frame.
  const keys = createMemo(() => canvas.designs().map((design) => design.key), [], {
    equals: (a, b) => a.length === b.length && a.every((key, index) => key === b[index]),
  })
  // The selection is a key, or the id of a design opened from the thread before its key was known.
  const selected = createMemo(() => {
    const value = canvas.selected()
    if (!value) return undefined
    if (byKey().has(value)) return value
    return canvas.designs().find((design) => design.id === value)?.key
  })
  const title = (design: Design) => design.title ?? language.t("secondBrain.canvas.untitled")

  return (
    // The grid and a design shown large fade through to each other.
    <ViewSwitch key={selected() ?? ""} class="h-full">
      <Show
        when={selected()}
        keyed
        fallback={
          <Show
            when={keys().length > 0}
            fallback={
              <div class="h-full px-6 pb-42 flex items-center justify-center text-center">
                <div class="max-w-56 text-[13px] leading-5 text-v2-text-text-muted">
                  {language.t("secondBrain.canvas.empty")}
                </div>
              </div>
            }
          >
            <div class="h-full overflow-y-auto px-3 pb-3">
              <div class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                <For each={keys()}>
                  {(key) => (
                    <Show when={byKey().get(key)}>
                      {(design) => (
                        <div class="flex min-w-0 flex-col gap-1.5 rounded-[16px] bg-v2-background-bg-layer-01 p-1.5 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
                          {/* Fixed white: a design is a standalone page that assumes a white canvas. */}
                          <button
                            type="button"
                            class="relative block aspect-[16/10] w-full overflow-hidden rounded-[10px] bg-[#fff]"
                            aria-label={language.t("secondBrain.canvas.view", { title: title(design()) })}
                            onClick={() => canvas.select(key)}
                          >
                            {/* A streaming design draws in the large view; its card waits for the finished page. */}
                            <Show
                              when={!design().streaming}
                              fallback={
                                <div class="absolute inset-0 flex items-center justify-center gap-2 bg-v2-background-bg-layer-01 text-[13px] text-v2-text-text-muted">
                                  <span class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse" />
                                  {language.t("secondBrain.canvas.drawingCard")}
                                </div>
                              }
                            >
                              <DesignPreview design={design()} title={title(design())} />
                            </Show>
                          </button>
                          <div class="flex min-w-0 items-center gap-2 pl-1.5">
                            <span class="min-w-0 truncate text-[13px] text-v2-text-text-base">{title(design())}</span>
                            <Show when={!design().streaming}>
                              <ButtonV2
                                size="small"
                                variant="ghost"
                                class="ml-auto shrink-0"
                                onClick={() => canvas.use(design())}
                              >
                                {language.t("secondBrain.canvas.use")}
                              </ButtonV2>
                            </Show>
                          </div>
                        </div>
                      )}
                    </Show>
                  )}
                </For>
              </div>
            </div>
          </Show>
        }
      >
        {(key) => (
          <Show when={byKey().get(key)}>{(design) => <LargeDesign design={design()} title={title(design())} />}</Show>
        )}
      </Show>
    </ViewSwitch>
  )
}

/**
 * One design shown large. A design that is streaming when it opens draws live, with a Drawing chip and
 * a Preview / Code switch; one from history shows as a finished page, as before.
 */
function LargeDesign(props: { design: CanvasDesign; title: string }) {
  const canvas = useDesignCanvas()
  const language = useLanguage()
  const live = untrack(() => !!props.design.streaming)
  const [view, setView] = createStore<{ mode: "preview" | "code" }>({ mode: "preview" })
  const large = createMemo(() => designTooLarge(props.design.source))
  let code: HTMLPreElement | undefined
  // Code follows the source to its end while it streams.
  createEffect(
    on(
      () => [props.design.source, view.mode] as const,
      () => {
        if (view.mode === "code" && props.design.streaming && code) code.scrollTop = code.scrollHeight
      },
    ),
  )
  const tooLarge = (
    <div class="flex size-full items-center justify-center p-4 text-center text-[13px] text-v2-text-text-muted bg-v2-background-bg-layer-01">
      {language.t("secondBrain.canvas.tooLarge")}
    </div>
  )
  return (
    <div class="flex h-full min-h-0 flex-col" data-canvas-design={live ? "live" : "history"}>
      {/* In a narrow panel the view switch and Use wrap below the title instead of squeezing it. */}
      <div class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pb-2">
        <div class="flex min-w-0 flex-1 basis-48 items-center gap-2">
          <TooltipV2 placement="bottom" value={language.t("secondBrain.canvas.back")}>
            <IconButtonV2
              icon={<Icon name="arrow-left" />}
              variant="ghost-muted"
              aria-label={language.t("secondBrain.canvas.back")}
              onClick={() => canvas.select(undefined)}
            />
          </TooltipV2>
          <span class="min-w-0 truncate text-[13px] text-v2-text-text-base [font-weight:500]">{props.title}</span>
          <Show when={live}>
            <span
              data-slot="canvas-design-status"
              class="flex shrink-0 items-center gap-1.5 rounded-full bg-v2-background-bg-layer-01 px-2 py-0.5 text-[12px] text-v2-text-text-muted"
            >
              <Show when={props.design.streaming}>
                <span class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse" />
              </Show>
              {props.design.streaming
                ? language.t("secondBrain.canvas.drawing")
                : language.t("secondBrain.canvas.drawn")}
            </span>
          </Show>
        </div>
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <Show when={live}>
            <SegmentedControlV2
              aria-label={language.t("secondBrain.canvas.viewMode")}
              value={view.mode}
              onChange={(value) => setView("mode", value === "code" ? "code" : "preview")}
            >
              <SegmentedControlItemV2 value="preview">
                {language.t("secondBrain.canvas.preview")}
              </SegmentedControlItemV2>
              <SegmentedControlItemV2 value="code">{language.t("secondBrain.canvas.code")}</SegmentedControlItemV2>
            </SegmentedControlV2>
          </Show>
          <Show when={!props.design.streaming}>
            <ButtonV2 size="small" variant="neutral" class="shrink-0" onClick={() => canvas.use(props.design)}>
              {language.t("secondBrain.canvas.use")}
            </ButtonV2>
          </Show>
        </div>
      </div>
      <div class="relative min-h-0 flex-1 px-3 pb-3">
        {/* Both views stay mounted, so switching never rebuilds the frame. */}
        <div
          class="size-full overflow-hidden rounded-[12px] border border-v2-border-border-muted bg-[#fff]"
          classList={{ hidden: view.mode === "code" }}
        >
          <Show
            when={live}
            fallback={<DesignFrame design={props.design} title={props.title} class="block size-full border-0" />}
          >
            <Show when={!large()} fallback={tooLarge}>
              <LiveDesignFrame design={props.design} title={props.title} class="block size-full border-0" />
            </Show>
          </Show>
        </div>
        <Show when={live}>
          <pre
            ref={code}
            data-slot="canvas-design-code"
            class="size-full overflow-auto whitespace-pre-wrap break-words rounded-[12px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-3 font-mono text-[12px] leading-5 text-v2-text-text-base"
            classList={{ hidden: view.mode !== "code" }}
          >
            {props.design.source}
            <Show when={props.design.streaming}>
              <span
                data-slot="canvas-design-caret"
                class="ml-px inline-block h-[1.1em] w-0.5 translate-y-[0.2em] bg-v2-background-bg-accent"
              />
            </Show>
          </pre>
        </Show>
      </div>
    </div>
  )
}

function DesignPreview(props: { design: Design; title: string }) {
  const [scale, setScale] = createSignal(0)
  let box!: HTMLDivElement
  onMount(() => {
    const observer = new ResizeObserver((entries) => setScale((entries[0]?.contentRect.width ?? 0) / ARTBOARD_WIDTH))
    observer.observe(box)
    onCleanup(() => observer.disconnect())
  })
  return (
    <div ref={box} class="absolute inset-0" aria-hidden="true">
      <DesignFrame
        design={props.design}
        title={props.title}
        class="pointer-events-none origin-top-left border-0"
        style={{ width: `${ARTBOARD_WIDTH}px`, height: `${ARTBOARD_HEIGHT}px`, transform: `scale(${scale()})` }}
        preview
      />
    </div>
  )
}

/** The design in a sandboxed frame (see design-fence.ts), or a notice when it is over the size cap. */
function DesignFrame(props: {
  design: Design
  title: string
  class: string
  style?: Record<string, string>
  preview?: boolean
}) {
  const language = useLanguage()
  return (
    <Show
      when={!designTooLarge(props.design.source)}
      fallback={
        <div class="flex size-full items-center justify-center p-4 text-center text-[13px] text-v2-text-text-muted bg-v2-background-bg-layer-01">
          {language.t("secondBrain.canvas.tooLarge")}
        </div>
      }
    >
      <iframe
        ref={(el) => {
          // Sandboxed before the document is set and before the frame is attached.
          el.setAttribute("sandbox", DESIGN_SANDBOX)
          el.srcdoc = designDocument(props.design.source)
        }}
        referrerpolicy="no-referrer"
        loading="lazy"
        title={props.title}
        tabIndex={props.preview ? -1 : undefined}
        class={props.class}
        style={props.style}
      />
    </Show>
  )
}
