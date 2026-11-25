import { useParams } from "@solidjs/router"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { createStore } from "solid-js/store"
import { Index, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Presence } from "@tenon/ui/v2/presence"
import { motionDuration, prefersReducedMotion } from "@tenon/ui/v2/motion"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { DictationFailure, DictationPlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { showToast } from "@/utils/toast"
import { dictationLanguage } from "./dictation-language"
import { mergeCaption } from "./dictation-caption"
import { captionChanges, dictationLanguageName, replaceBeforeCaret } from "./dictation-review"
import { levelReading, voiceGain, waveBars } from "./dictation-wave"
import { elapsedLabel, ghostLayer, type GhostLayer } from "./dictation-ghost"
import "./dictation.css"

const METER_BARS = 7

function composerBox(button: HTMLElement | undefined) {
  return (
    button?.closest<HTMLElement>('[data-slot="prompt-input-box"]') ??
    button?.closest<HTMLElement>('[data-component="composer-box"]:not([data-size="compact"])') ??
    undefined
  )
}

const TRANSCRIPT_PREVIEW = 300

export function PromptDictationButton(props: { dictation: DictationPlatform; restoreFocus: () => void }) {
  const language = useLanguage()
  const settings = useSettings()
  const params = useParams()
  let thread: string | undefined
  let button: HTMLElement | undefined
  const [state, setState] = createStore({
    phase: "idle" as "idle" | "starting" | "recording" | "transcribing",
    level: 0,
    partial: "",
    language: undefined as string | undefined,
    anchor: undefined as { right: number; bottom: number } | undefined,
    capsule: undefined as { left: number; top: number } | undefined,
  })
  const place = () => {
    const rect = button?.getBoundingClientRect()
    if (rect) setState("anchor", { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.top + 8 })
    const box = composerBox(button)
    const tray = box?.parentElement?.querySelector<HTMLElement>(':scope > [data-slot="prompt-input-header"]')
    const edge = (tray ?? box)?.getBoundingClientRect()
    setState("capsule", edge ? { left: edge.left + edge.width / 2, top: edge.top - 8 } : undefined)
  }
  const follow = () => state.phase !== "idle" && place()
  makeEventListener(window, "resize", follow)
  makeEventListener(window, "scroll", follow, { capture: true, passive: true })
  const offLevel = props.dictation.onLevel((rms) => setState("level", Math.min(1, rms * 4)))
  let bands: number[] | undefined
  const offBands = props.dictation.onBands?.((values) => {
    if (state.phase === "recording") bands = values
  })
  let ghost: GhostLayer | undefined
  const dropGhost = () => {
    ghost?.remove()
    ghost = undefined
  }
  onCleanup(dropGhost)
  let started = 0
  let settling = false
  const runMeter = (meter: HTMLElement) => {
    const timer = () => meter.parentElement?.querySelector<HTMLElement>('[data-slot="dictation-capsule-timer"]')
    let bars: number[] = []
    let peak = 0
    let frame = 0
    const order = [5, 3, 1, 0, 2, 4, 6]
    const draw = () => {
      const gained = voiceGain(bands ?? [levelReading(state.level)], peak)
      peak = gained.peak
      bars = bands ? waveBars(gained.values, bars, METER_BARS) : waveBars(undefined, bars, METER_BARS, gained.values[0])
      Array.from(meter.children as HTMLCollectionOf<HTMLElement>).forEach(
        (span, index) => (span.style.transform = `scaleY(${0.14 + (bars[order[index]!] ?? 0) * 0.86})`),
      )
      const time = timer()
      if (time) time.textContent = elapsedLabel(performance.now() - started)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    onCleanup(() => cancelAnimationFrame(frame))
  }
  const offPartial = props.dictation.onPartial?.((text) => {
    if (state.phase !== "recording") return
    place()
    setState("partial", (shown) => mergeCaption(shown, text))
    ghost?.write(state.partial)
  })
  const offLimit = props.dictation.onLimit(() => {
    if (state.phase !== "recording") return
    showToast({ description: language.t("dictation.limitReached") })
    void finish()
  })
  let disposed = false
  onCleanup(() => {
    disposed = true
    offLevel()
    offBands?.()
    offPartial?.()
    offLimit()
    if (state.phase === "recording") void finish()
  })

  const report = (error: DictationFailure) => {
    const known = [
      "no_model",
      "engine_unavailable",
      "engine_exited",
      "no_microphone",
      "microphone_busy",
      "transcribe_timeout",
      "already_recording",
      "transcribing",
    ]
    const key =
      error.help?.key ?? (known.includes(error.code) ? `dictation.error.${error.code}` : "dictation.error.generic")
    showToast({
      variant: "error",
      title: language.t("dictation.error.title"),
      description: language.t(key as Parameters<typeof language.t>[0]),
      actions: error.help
        ? [
            {
              label: language.t("dictation.permission.open"),
              onClick: () => void props.dictation.openPermissionSettings(),
            },
          ]
        : undefined,
    })
  }

  const review = (shown: string, inserted: string, caret: Range | undefined) => {
    const changed = captionChanges(shown, inserted)
    if (changed === 0) return
    showToast({
      title: language.t(changed === 1 ? "dictation.revised.one" : "dictation.revised.other", { count: changed }),
      actions: [
        {
          label: language.t("dictation.revised.useShown"),
          onClick: () => {
            props.restoreFocus()
            requestAnimationFrame(() => {
              const selection = window.getSelection()
              if (
                caret &&
                caret.startContainer.nodeType === Node.TEXT_NODE &&
                caret.startContainer.isConnected &&
                selection
              ) {
                selection.removeAllRanges()
                selection.addRange(caret)
              }
              const spaced = inserted.startsWith(" ") ? ` ${shown.trim()}` : shown.trim()
              if (replaceBeforeCaret(inserted, spaced)) return
              void navigator.clipboard.writeText(shown.trim())
              showToast({ description: language.t("dictation.revised.copied") })
            })
          },
        },
        { label: language.t("common.dismiss"), onClick: "dismiss" },
      ],
    })
  }

  const finish = async () => {
    setState({ phase: "transcribing", level: 0 })
    ghost?.pause()
    const shown = state.partial
    const result = await props.dictation.stop()
    setState({ phase: "idle", partial: "" })
    bands = undefined
    const here = () => !disposed && params.id === thread
    if (result.error || !result.text || !here()) dropGhost()
    if (result.error?.code === "cancelled") return
    if (result.error) return report(result.error)
    if (!result.text) return
    if (ghost) {
      ghost.settle(result.text)
      const settle = prefersReducedMotion() ? 0 : motionDuration("long")
      settling = true
      if (settle > 0) await new Promise((done) => setTimeout(done, settle))
      settling = false
      dropGhost()
    }
    if (here())
      return insertAtCaret(result.text, props.restoreFocus, (inserted, caret) => review(shown, inserted, caret))
    const text = result.text
    showToast({
      persistent: true,
      title: language.t("dictation.transcript.title"),
      description: text.length > TRANSCRIPT_PREVIEW ? `${text.slice(0, TRANSCRIPT_PREVIEW)}…` : text,
      actions: [
        {
          label: language.t("dictation.transcript.copy"),
          onClick: () => void navigator.clipboard.writeText(text),
        },
        { label: language.t("common.dismiss"), onClick: "dismiss" },
      ],
    })
  }

  const toggle = async (clicks: number) => {
    if (state.phase === "starting" || settling) return
    if (state.phase === "transcribing") {
      if (clicks < 2) void props.dictation.cancel()
      return
    }
    if (state.phase === "idle") {
      thread = params.id
      const spoken = dictationLanguage(settings.dictation.language(), language.intl())
      setState({ phase: "starting", partial: "", language: dictationLanguageName(spoken, language.intl()) })
      place()
      const result = await props.dictation.start({ language: spoken })
      if (disposed) {
        if (!result.error) void props.dictation.cancel()
        return
      }
      if (result.error) {
        setState({ phase: "idle", level: 0 })
        return report(result.error)
      }
      started = performance.now()
      setState("phase", "recording")
      const box = composerBox(button)
      if (box) ghost = ghostLayer(box)
      return
    }
    await finish()
  }

  makeEventListener(
    window,
    "keydown",
    (event) => {
      if (event.key !== "Escape" || state.phase !== "recording") return
      event.preventDefault()
      event.stopPropagation()
      setState({ phase: "idle", partial: "", level: 0 })
      dropGhost()
      void props.dictation.cancel()
    },
    { capture: true },
  )

  const label = () =>
    state.phase === "transcribing"
      ? language.t("dictation.transcribing.cancel")
      : state.phase === "recording"
        ? language.t("dictation.live.stop")
        : language.t("dictation.action.dictate")
  const live = () => state.phase === "recording" || state.phase === "transcribing"
  return (
    <>
      <TooltipV2 placement="top" value={label()}>
        <IconButtonV2
          ref={(element: HTMLElement) => (button = element)}
          type="button"
          data-action="prompt-dictate"
          data-phase={state.phase}
          variant="ghost-muted"
          size="large"
          aria-label={label()}
          aria-pressed={state.phase === "recording"}
          aria-busy={state.phase === "starting" || state.phase === "transcribing"}
          state={state.phase === "recording" ? "pressed" : undefined}
          onClick={(event) => void toggle(event.detail)}
          icon={<MicIcon level={state.phase === "recording" ? state.level : undefined} />}
        />
      </TooltipV2>
      <Show when={state.capsule}>
        {(at) => (
          <Portal>
            <div
              class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full"
              style={{ left: `${at().left}px`, top: `${at().top}px` }}
            >
              <Presence
                when={live()}
                class="pointer-events-auto"
                enterClass="dictation-capsule-enter"
                exitClass="dictation-capsule-exit"
              >
                <div
                  data-component="dictation-capsule"
                  data-phase={state.phase}
                  role="status"
                  aria-live="polite"
                  aria-label={language.t("dictation.live.label")}
                  class="flex h-9 items-center gap-2.5 rounded-full bg-v2-background-bg-contrast pl-3.5 pr-1 text-v2-text-text-contrast shadow-[0_10px_28px_-10px_rgb(0_0_0/0.45)]"
                >
                  <Show
                    when={state.phase === "recording"}
                    fallback={
                      <span data-slot="dictation-capsule-swap" class="flex h-7 items-center gap-2 pr-2.5 text-[12px]">
                        <span
                          data-slot="dictation-spinner"
                          aria-hidden="true"
                          class="size-3.5 rounded-full border-2 border-current border-r-transparent"
                        />
                        {language.t("dictation.live.finishing")}
                      </span>
                    }
                  >
                    <span data-slot="dictation-capsule-timer" class="w-7 text-[12px] tabular-nums opacity-80">
                      0:00
                    </span>
                    <span
                      data-slot="dictation-meter"
                      ref={runMeter}
                      aria-hidden="true"
                      class="flex h-[18px] items-center gap-0.5"
                    >
                      <Index each={Array.from({ length: METER_BARS })}>
                        {() => <span class="block h-full w-[3px] rounded-full bg-current" />}
                      </Index>
                    </span>
                    <span
                      data-slot="dictation-live-language"
                      title={language.t("dictation.live.language", {
                        name: state.language ?? language.t("dictation.live.detect"),
                      })}
                      class="text-[11px] opacity-70"
                    >
                      {state.language ?? language.t("dictation.live.detect")}
                    </span>
                    <button
                      type="button"
                      data-action="dictation-stop"
                      data-slot="dictation-capsule-stop"
                      aria-label={language.t("dictation.live.stop")}
                      class="grid size-7 place-items-center rounded-full"
                      onClick={() => void finish()}
                    >
                      <StopIcon />
                    </button>
                  </Show>
                  <span class="sr-only">{state.partial}</span>
                </div>
              </Presence>
            </div>
          </Portal>
        )}
      </Show>
      <Show when={!state.capsule && live() && state.anchor}>
        {(anchor) => (
          <Portal>
            <div
              data-component="dictation-live"
              data-phase={state.phase}
              role="status"
              aria-live="polite"
              aria-label={language.t("dictation.live.label")}
              class="pointer-events-none fixed z-50 flex max-w-[min(420px,calc(100vw-32px))] animate-enter items-start gap-2 rounded-[16px] bg-v2-background-bg-raised px-3.5 py-2.5 text-[13px] leading-5 shadow-[0_0_0_1px_var(--v2-border-border-base),0_12px_32px_-12px_rgb(0_0_0/0.28)]"
              style={{ right: `${anchor().right}px`, bottom: `${anchor().bottom}px` }}
            >
              <span
                class="mt-1.5 size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse"
                aria-hidden="true"
              />
              <span class="line-clamp-3 min-w-0 italic text-v2-text-text-muted [overflow-wrap:anywhere]" dir="auto">
                <Show when={state.partial} fallback={language.t("dictation.live.listening")}>
                  {captionTail(state.partial)}
                </Show>
              </span>
              <LanguageChip name={state.language} />
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}

function LanguageChip(props: { name: string | undefined }) {
  const language = useLanguage()
  const text = () => props.name ?? language.t("dictation.live.detect")
  return (
    <span
      data-slot="dictation-live-language"
      title={language.t("dictation.live.language", { name: text() })}
      class="shrink-0 rounded-full bg-v2-background-bg-layer-02 px-2 text-[11px] not-italic leading-5 text-v2-text-text-muted"
    >
      {text()}
    </span>
  )
}

const CAPTION_CHARS = 180

function captionTail(text: string) {
  if (text.length <= CAPTION_CHARS) return text
  const tail = text.slice(-CAPTION_CHARS)
  return `…${tail.slice(tail.indexOf(" ") + 1)}`
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="2" fill="currentColor" />
    </svg>
  )
}

export function MicIcon(props: { level?: number }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" stroke="currentColor" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" stroke="currentColor" stroke-linecap="round" />
      <Show when={props.level !== undefined}>
        <rect
          x="6"
          y={9.5 - 7.5 * (props.level ?? 0)}
          width="4"
          height={7.5 * (props.level ?? 0)}
          rx="2"
          fill="currentColor"
          opacity="0.6"
        />
      </Show>
    </svg>
  )
}

function insertAtCaret(
  text: string,
  restoreFocus: () => void,
  inserted?: (spaced: string, caret: Range | undefined) => void,
) {
  restoreFocus()
  requestAnimationFrame(() => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    const before = node?.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").slice(0, selection!.anchorOffset) : ""
    const spaced = before && !/\s$/.test(before) ? ` ${text}` : text
    const done = () => {
      const current = window.getSelection()
      inserted?.(spaced, current && current.rangeCount > 0 ? current.getRangeAt(0).cloneRange() : undefined)
    }
    if (typeof document.execCommand === "function" && document.execCommand("insertText", false, spaced)) return done()
    const target = document.activeElement
    if (!(target instanceof HTMLElement) || !target.isContentEditable || !selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const added = document.createTextNode(spaced)
    range.insertNode(added)
    range.setStartAfter(added)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: spaced }))
    done()
  })
}
