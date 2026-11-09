import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon as IconV2 } from "@tenon/ui/v2/icon"
import { useLanguage } from "@/context/language"

const ASSISTANT = '[data-slot="session-turn-assistant-content"]'
/** Longer passages are cut so a quote can't swamp the message it is attached to. */
export const QUOTE_LIMIT = 2000

/** The text to quote, or undefined when the selection is empty. */
export function quoteText(raw: string) {
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (!text) return
  return text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT).trimEnd()}…` : text
}

function inAssistant(root: HTMLElement, node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement
  const content = element?.closest(ASSISTANT)
  return !!content && root.contains(content)
}

type Pill = { text: string; x: number; y: number; below: boolean }

/**
 * A Reply pill over text selected in an assistant reply. Reply hands the passage to the composer as a quote;
 * Copy copies it. The pill follows the selection and goes when it collapses, on scroll or on Escape.
 */
export function SelectionReply(props: { root: () => HTMLElement | undefined; onReply: (text: string) => void }) {
  const language = useLanguage()
  const [pill, setPill] = createSignal<Pill>()
  let frame = 0

  const read = () => {
    const root = props.root()
    const selection = window.getSelection()
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return setPill(undefined)
    if (!inAssistant(root, selection.anchorNode) || !inAssistant(root, selection.focusNode)) return setPill(undefined)
    const text = quoteText(selection.toString())
    if (!text) return setPill(undefined)
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    const below = rect.top < 56
    setPill({ text, x: rect.left + rect.width / 2, y: below ? rect.bottom + 8 : rect.top - 8, below })
  }
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(read)
  }
  const hide = () => setPill(undefined)
  const collapse = () => {
    if (pill() && window.getSelection()?.isCollapsed) hide()
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && pill()) hide()
  }

  onMount(() => {
    document.addEventListener("mouseup", schedule)
    document.addEventListener("keyup", schedule)
    document.addEventListener("selectionchange", collapse)
    document.addEventListener("keydown", escape)
    // Capture: the timeline scrolls inside its own viewport.
    document.addEventListener("scroll", hide, true)
    onCleanup(() => {
      cancelAnimationFrame(frame)
      document.removeEventListener("mouseup", schedule)
      document.removeEventListener("keyup", schedule)
      document.removeEventListener("selectionchange", collapse)
      document.removeEventListener("keydown", escape)
      document.removeEventListener("scroll", hide, true)
    })
  })

  const done = () => {
    hide()
    window.getSelection()?.removeAllRanges()
  }

  return (
    <Show when={pill()}>
      {(current) => (
        <Portal>
          <div
            data-component="selection-reply"
            role="toolbar"
            aria-label={language.t("secondBrain.quote.toolbar")}
            class="fixed z-50 flex gap-0.5 rounded-[16px] bg-v2-background-bg-floating p-1 shadow-[var(--v2-elevation-floating)] animate-enter"
            style={{
              left: `${current().x}px`,
              top: `${current().y}px`,
              transform: current().below ? "translateX(-50%)" : "translate(-50%, -100%)",
            }}
            // Keep the selection while the pointer is on the pill.
            onMouseDown={(event) => event.preventDefault()}
            onMouseUp={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              class="flex h-8 items-center gap-1.5 rounded-[12px] px-3 text-[13px] font-[500] text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none"
              onClick={() => {
                props.onReply(current().text)
                done()
              }}
            >
              <IconV2 name="reply" class="shrink-0" />
              {language.t("secondBrain.quote.reply")}
            </button>
            <button
              type="button"
              class="flex h-8 items-center rounded-[12px] px-3 text-[13px] font-[500] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none"
              onClick={() => {
                void navigator.clipboard?.writeText(current().text)
                done()
              }}
            >
              {language.t("secondBrain.quote.copy")}
            </button>
          </div>
        </Portal>
      )}
    </Show>
  )
}
