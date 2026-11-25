import { For, Show, createEffect, createMemo, on, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { designTooLarge, type CanvasDesign, type Design } from "@tenon/session-ui/design-fence"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { ViewSwitch } from "@tenon/ui/v2/view-switch"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import {
  designInspectHover,
  designInspectScroll,
  pickedDesignElement,
  type PickedDesignElement,
  type Rect,
} from "@tenon/session-ui/design-inspect"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { submitComposer } from "@/components/prompt-input/reply-bridge"
import { canvasNotesStore, notePosition, type CanvasNote } from "@/pages/session/canvas-notes"
import { useDesignCanvas } from "@/pages/session/design-canvas"
import { DesignBoard } from "@/pages/session/design-board"
import { DesignFrame, LiveDesignFrame } from "@/pages/session/live-design-frame"
import { useSDK } from "@/context/sdk"
import { useArtifacts } from "@/features/artifacts/artifacts"
import { ProjectArtifactsBoard } from "@/features/artifacts/artifacts-view"

export function SessionCanvasTab() {
  const language = useLanguage()
  const sdk = useSDK()
  const artifacts = useArtifacts()
  const [board, setBoard] = createStore<{ view: "designs" | "files" }>({ view: "designs" })
  const files = () => artifacts.list(sdk().directory).length > 0
  return (
    <div class="flex h-full min-h-0 flex-col">
      <Show when={files()}>
        <div class="flex shrink-0 px-3 pb-2 pt-1">
          <SegmentedControlV2
            aria-label={language.t("secondBrain.canvas.title")}
            value={board.view}
            onChange={(value) => value && setBoard("view", value === "files" ? "files" : "designs")}
          >
            <SegmentedControlItemV2 value="designs" data-action="canvas-designs">
              {language.t("secondBrain.canvas.designs")}
            </SegmentedControlItemV2>
            <SegmentedControlItemV2 value="files" data-action="canvas-files">
              {language.t("secondBrain.canvas.files")}
            </SegmentedControlItemV2>
          </SegmentedControlV2>
        </div>
      </Show>
      <div class="min-h-0 flex-1">
        <Show when={files() && board.view === "files"} fallback={<DesignsBoard />}>
          <ProjectArtifactsBoard />
        </Show>
      </div>
    </div>
  )
}

function DesignsBoard() {
  const canvas = useDesignCanvas()
  const language = useLanguage()
  const byKey = createMemo(() => new Map(canvas.designs().map((design) => [design.key, design])))
  const keys = createMemo(() => canvas.designs().map((design) => design.key), [], {
    equals: (a, b) => a.length === b.length && a.every((key, index) => key === b[index]),
  })
  const selected = createMemo(() => {
    const value = canvas.selected()
    if (!value) return undefined
    if (byKey().has(value)) return value
    return canvas.designs().find((design) => design.id === value)?.key
  })
  const title = (design: Design) => design.title ?? language.t("secondBrain.canvas.untitled")

  return (
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
            <DesignBoard
              keys={keys()}
              design={(key) => byKey().get(key)}
              title={title}
              onOpen={(key) => canvas.select(key)}
              onUse={(design) => canvas.use(design)}
            />
          </Show>
        }
      >
        {(key) => (
          <Show when={byKey().get(key)}>
            {(design) => <LargeDesign design={design()} designKey={key} title={title(design())} />}
          </Show>
        )}
      </Show>
    </ViewSwitch>
  )
}

function LargeDesign(props: { design: CanvasDesign; designKey: string; title: string }) {
  const canvas = useDesignCanvas()
  const language = useLanguage()
  const prompt = usePrompt()
  const [inspect, setInspect] = createStore({
    on: false,
    hover: undefined as Rect | undefined,
    picked: undefined as PickedDesignElement | undefined,
    draft: "",
    scroll: { x: 0, y: 0 },
    chosen: undefined as Rect | undefined,
  })
  let overlay: HTMLDivElement | undefined
  const notes = () => canvasNotesStore.list(props.designKey)
  const pending = () => canvasNotesStore.pending(props.designKey)
  const onInspect = (data: unknown) => {
    const picked = pickedDesignElement(data)
    if (picked) return setInspect({ picked, draft: "", hover: undefined, chosen: picked.rect })
    const hover = designInspectHover(data)
    if (hover !== undefined) return setInspect("hover", hover ?? undefined)
    const scroll = designInspectScroll(data)
    if (scroll) setInspect("scroll", scroll)
  }
  const addNote = () => {
    const id = inspect.picked ? canvasNotesStore.add(props.designKey, inspect.picked, inspect.draft) : undefined
    setInspect({ picked: undefined, draft: "", chosen: undefined })
    return id
  }
  const sendNotes = (only?: string) => {
    const sending = canvasNotesStore.send(props.designKey, only)
    if (sending.length === 0) return
    const text = [
      language.t("secondBrain.canvas.notes.intro", { title: props.title }),
      ...sending.map((note: CanvasNote) =>
        note.text
          ? language.t("secondBrain.canvas.notes.line", {
              number: note.number,
              selector: note.selector,
              text: note.text,
              note: note.note,
            })
          : language.t("secondBrain.canvas.notes.lineNoText", {
              number: note.number,
              selector: note.selector,
              note: note.note,
            }),
      ),
    ].join("\n")
    const parts = [...prompt.current()]
    const end = parts.reduce((total, part) => total + ("content" in part ? part.content.length : 0), 0)
    parts.push({ type: "text", content: `\n${text}\n`, start: end, end: end + text.length + 2 })
    prompt.set(parts, end + text.length + 2)
    setInspect({ on: false, hover: undefined })
    if (only === undefined) submitComposer()
  }
  const live = untrack(() => !!props.design.streaming)
  const [view, setView] = createStore<{ mode: "preview" | "code" }>({ mode: "preview" })
  const large = createMemo(() => designTooLarge(props.design.source))
  let code: HTMLPreElement | undefined
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
          <ButtonV2
            size="small"
            variant={inspect.on ? "tonal" : "neutral"}
            class="shrink-0"
            aria-pressed={inspect.on}
            disabled={!!props.design.streaming || view.mode === "code"}
            data-action="canvas-notes"
            onClick={() => setInspect({ on: !inspect.on, hover: undefined, picked: undefined })}
          >
            {pending().length > 0
              ? language.t("secondBrain.canvas.notes.toggleCount", { count: pending().length })
              : language.t("secondBrain.canvas.notes.toggle")}
          </ButtonV2>
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
          <ButtonV2
            size="small"
            variant="neutral"
            class="shrink-0"
            classList={{ invisible: !!props.design.streaming }}
            disabled={!!props.design.streaming}
            aria-hidden={props.design.streaming ? "true" : undefined}
            tabIndex={props.design.streaming ? -1 : undefined}
            onClick={() => canvas.use(props.design)}
          >
            {language.t("secondBrain.canvas.use")}
          </ButtonV2>
        </div>
      </div>
      <div class="relative min-h-0 flex-1 px-3 pb-3">
        <div
          class="relative size-full overflow-hidden rounded-[12px] border border-v2-border-border-muted bg-[#fff]"
          classList={{ hidden: view.mode === "code" }}
        >
          <Show
            when={live}
            fallback={
              <DesignFrame
                design={props.design}
                title={props.title}
                class="block size-full border-0"
                inspect={inspect.on}
                onInspect={onInspect}
              />
            }
          >
            <Show when={!large()} fallback={tooLarge}>
              <LiveDesignFrame
                design={props.design}
                title={props.title}
                class="block size-full border-0"
                inspect={inspect.on}
                onInspect={onInspect}
              />
            </Show>
          </Show>
          <div ref={overlay} class="pointer-events-none absolute inset-0" data-slot="canvas-notes-overlay">
            <Show when={inspect.on && (inspect.chosen ?? inspect.hover)}>
              {(rect) => (
                <div
                  class="absolute rounded-[6px] shadow-[0_0_0_2px_var(--v2-border-border-focus)]"
                  style={{
                    left: `${rect().x}px`,
                    top: `${rect().y}px`,
                    width: `${rect().width}px`,
                    height: `${rect().height}px`,
                  }}
                />
              )}
            </Show>
            <For each={notes()}>
              {(note) => {
                const at = () => notePosition(note, inspect.scroll)
                return (
                  <span
                    class="absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] tabular-nums animate-enter"
                    classList={{
                      "bg-v2-background-bg-accent text-v2-text-text-on-accent": !note.sent,
                      "bg-v2-background-bg-layer-02 text-v2-text-text-muted": note.sent,
                    }}
                    style={{ left: `${at().x}px`, top: `${at().y}px` }}
                  >
                    {note.number}
                  </span>
                )
              }}
            </For>
            <Show when={inspect.picked}>
              {(picked) => (
                <form
                  class="pointer-events-auto absolute flex w-[240px] max-w-[calc(100%-16px)] flex-col gap-2 rounded-[16px] bg-v2-background-bg-floating p-2.5 shadow-[0_0_0_1px_var(--v2-border-border-muted),var(--v2-elevation-raised)] animate-enter"
                  style={{
                    left: `${Math.max(8, Math.min(picked().rect.x - inspect.scroll.x, (overlay?.clientWidth ?? 9999) - 248))}px`,
                    top: `${Math.max(8, picked().rect.y - inspect.scroll.y + picked().rect.height + 6)}px`,
                  }}
                  onSubmit={(event) => {
                    event.preventDefault()
                    addNote()
                  }}
                >
                  <span class="truncate font-mono text-[11px] text-v2-text-text-muted">
                    {picked().selector}
                    {picked().text ? ` · "${picked().text.slice(0, 40)}"` : ""}
                  </span>
                  <textarea
                    ref={(el) => queueMicrotask(() => el.focus())}
                    rows={2}
                    class="w-full resize-none rounded-[10px] bg-v2-background-bg-base px-2.5 py-1.5 text-[13px] text-v2-text-text-base shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
                    value={inspect.draft}
                    placeholder={language.t("secondBrain.canvas.notes.placeholder")}
                    aria-label={language.t("secondBrain.canvas.notes.placeholder")}
                    onInput={(event) => setInspect("draft", event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setInspect({ picked: undefined, draft: "", chosen: undefined })
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        addNote()
                      }
                    }}
                  />
                  <div class="flex items-center gap-1.5">
                    <ButtonV2 type="submit" size="small" variant="contrast" disabled={!inspect.draft.trim()}>
                      {language.t("secondBrain.canvas.notes.add")}
                    </ButtonV2>
                    <ButtonV2
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!inspect.draft.trim()}
                      onClick={() => {
                        const id = addNote()
                        if (id) sendNotes(id)
                      }}
                    >
                      {language.t("secondBrain.canvas.notes.sendNow")}
                    </ButtonV2>
                  </div>
                </form>
              )}
            </Show>
          </div>
        </div>
        <Show when={notes().length > 0 && view.mode === "preview"}>
          <div
            data-slot="canvas-notes-tray"
            data-motion="rise"
            class="mt-2 flex animate-enter flex-col rounded-[12px] bg-v2-background-bg-layer-01 py-1"
          >
            <For each={notes()}>
              {(note) => (
                <div class="flex min-h-9 items-center gap-2 px-3 text-[12px]">
                  <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-v2-background-bg-layer-02 text-[10px] tabular-nums">
                    {note.number}
                  </span>
                  <span class="min-w-0 flex-1 truncate" classList={{ "text-v2-text-text-muted": note.sent }}>
                    <span class="font-mono text-[11px] text-v2-text-text-muted">{note.selector}</span> · {note.note}
                  </span>
                  <Show
                    when={!note.sent}
                    fallback={
                      <span class="shrink-0 text-v2-text-text-muted">
                        {language.t("secondBrain.canvas.notes.sent")}
                      </span>
                    }
                  >
                    <IconButtonV2
                      variant="ghost-muted"
                      size="small"
                      icon={<Icon name="close" size="small" />}
                      aria-label={language.t("secondBrain.canvas.notes.remove", { number: note.number })}
                      onClick={() => canvasNotesStore.remove(props.designKey, note.id)}
                    />
                  </Show>
                </div>
              )}
            </For>
            <Show when={pending().length > 0}>
              <div class="flex justify-end px-2 pt-1">
                <ButtonV2 size="small" variant="contrast" data-action="canvas-notes-send" onClick={() => sendNotes()}>
                  {language.plural("secondBrain.canvas.notes.send", pending().length, { count: pending().length })}
                </ButtonV2>
              </div>
            </Show>
          </div>
        </Show>
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
