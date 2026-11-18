import { useParams } from "@solidjs/router"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { createStore } from "solid-js/store"
import { onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { DictationFailure, DictationPlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { showToast } from "@/utils/toast"
import { dictationLanguage } from "./dictation-language"

// Toasts have a fixed height, so a long transcript would push Copy out of reach. Copy takes all of it.
const TRANSCRIPT_PREVIEW = 300

/**
 * The composer's mic: click to record through the desktop dictation engine, click again to stop
 * and insert the transcript at the caret. Rendered only when the platform exposes dictation.
 */
export function PromptDictationButton(props: { dictation: DictationPlatform; restoreFocus: () => void }) {
  const language = useLanguage()
  const settings = useSettings()
  const params = useParams()
  // The composer stays mounted across threads in the same folder, so a recording remembers its own.
  let thread: string | undefined
  let button: HTMLElement | undefined
  const [state, setState] = createStore({
    phase: "idle" as "idle" | "starting" | "recording" | "transcribing",
    level: 0,
    // The words heard so far, while recording; the final transcript replaces them in the composer.
    partial: "",
    // Where the live caption sits: above the mic, right-aligned to it (viewport pixels).
    anchor: undefined as { right: number; bottom: number } | undefined,
  })
  const place = () => {
    const rect = button?.getBoundingClientRect()
    if (rect) setState("anchor", { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.top + 8 })
  }
  // The caption follows the mic if the window is resized or scrolled while recording.
  const follow = () => state.phase !== "idle" && place()
  makeEventListener(window, "resize", follow)
  makeEventListener(window, "scroll", follow, { capture: true, passive: true })
  const offLevel = props.dictation.onLevel((rms) => setState("level", Math.min(1, rms * 4)))
  const offPartial = props.dictation.onPartial?.((text) => {
    if (state.phase !== "recording") return
    place()
    setState("partial", text)
  })
  const offLimit = props.dictation.onLimit(() => {
    if (state.phase !== "recording") return
    showToast({ description: language.t("dictation.limitReached") })
    void finish()
  })
  // A start still in flight at unmount is cancelled once it resolves, so the mic doesn't keep recording.
  // A recording in progress is transcribed anyway and offered, so the words aren't lost.
  let disposed = false
  onCleanup(() => {
    disposed = true
    offLevel()
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
    // A denied microphone names its platform's help text and offers the privacy settings.
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

  const finish = async () => {
    setState({ phase: "transcribing", level: 0 })
    const result = await props.dictation.stop()
    setState({ phase: "idle", partial: "" })
    if (result.error?.code === "cancelled") return
    if (result.error) return report(result.error)
    if (!result.text) return
    if (!disposed && params.id === thread) return insertAtCaret(result.text, props.restoreFocus)
    // The composer is gone or shows another thread, and typing there could reach a note or the wrong draft.
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
    if (state.phase === "starting") return
    // Gives up on a transcription that is taking too long; finish() ends quietly. The second click of
    // a double-click on stop is not a cancel: it would throw the recording away.
    if (state.phase === "transcribing") {
      if (clicks < 2) void props.dictation.cancel()
      return
    }
    if (state.phase === "idle") {
      thread = params.id
      setState({ phase: "starting", partial: "" })
      place()
      // A known spoken language: Whisper guessing it per recording sometimes answered in another language.
      const result = await props.dictation.start({
        language: dictationLanguage(settings.dictation.language(), language.intl()),
      })
      if (disposed) {
        if (!result.error) void props.dictation.cancel()
        return
      }
      if (result.error) {
        setState({ phase: "idle", level: 0 })
        return report(result.error)
      }
      return setState("phase", "recording")
    }
    await finish()
  }

  const label = () =>
    state.phase === "transcribing"
      ? language.t("dictation.transcribing.cancel")
      : language.t("dictation.action.dictate")
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
      {/* The live caption: the words heard so far float above the mic while you speak, newest at the end. It sits
          outside the composer (a portal), so the composer's clipping and layout don't move. */}
      <Show when={(state.phase === "recording" || state.phase === "transcribing") && state.anchor}>
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
              {/* The tail of the transcript: three lines, older words scrolling off the top. */}
              <span class="line-clamp-3 min-w-0 [overflow-wrap:anywhere] text-v2-text-text-base" dir="auto">
                <Show
                  when={state.partial}
                  fallback={<span class="text-v2-text-text-muted">{language.t("dictation.live.listening")}</span>}
                >
                  {captionTail(state.partial)}
                </Show>
              </span>
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}

// About three lines at the caption's width: the newest words stay in view as the transcript grows.
const CAPTION_CHARS = 180

function captionTail(text: string) {
  if (text.length <= CAPTION_CHARS) return text
  const tail = text.slice(-CAPTION_CHARS)
  return `…${tail.slice(tail.indexOf(" ") + 1)}`
}

/** A microphone glyph; `level` (0–1) fills it while recording. */
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

/** Focuses the composer at its saved caret and types the transcript there, spaced from the text before it. */
function insertAtCaret(text: string, restoreFocus: () => void) {
  restoreFocus()
  // restoreFocus places the caret on the next frame; insert after it.
  requestAnimationFrame(() => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    const before = node?.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").slice(0, selection!.anchorOffset) : ""
    const spaced = before && !/\s$/.test(before) ? ` ${text}` : text
    if (typeof document.execCommand === "function" && document.execCommand("insertText", false, spaced)) return
    const target = document.activeElement
    if (!(target instanceof HTMLElement) || !target.isContentEditable || !selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const inserted = document.createTextNode(spaced)
    range.insertNode(inserted)
    range.setStartAfter(inserted)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: spaced }))
  })
}
