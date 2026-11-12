import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon as IconV2 } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { ComposerBox } from "@/components/prompt-input/composer-box"
import { createComposerController } from "@/components/prompt-input/composer-controller"
import { sendReply } from "@/components/prompt-input/reply-bridge"
import { useLanguage } from "@/context/language"
import { placeReplyCard, quoteText } from "./selection-reply-model"

const ASSISTANT = '[data-slot="session-turn-assistant-content"]'
const PASSAGE = "tenon-reply-passage"

function inAssistant(root: HTMLElement, node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement
  const content = element?.closest(ASSISTANT)
  return !!content && root.contains(content)
}

function highlightPassage(range: Range | undefined) {
  if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") return
  if (range) CSS.highlights.set(PASSAGE, new Highlight(range))
  else CSS.highlights.delete(PASSAGE)
}

type Pill = { text: string; x: number; y: number; top: number; bottom: number; below: boolean; range: Range }
type Card = { text: string; x: number; top: number; bottom: number }

/**
 * A Reply pill over text selected in an assistant reply. Reply grows the pill into a card: the passage, a text box
 * with dictation, and Send, which posts a new message quoting the passage through the thread composer. Copy copies
 * the passage. The pill follows the selection and goes when it collapses, on scroll or on Escape; the card stays
 * until it is sent, closed, or Escape is pressed (or a click lands outside it while it is empty).
 * `onReply` is the fallback when no thread composer is mounted to send through: the passage becomes a quote there.
 */
export function SelectionReply(props: { root: () => HTMLElement | undefined; onReply: (text: string) => void }) {
  const language = useLanguage()
  const [pill, setPill] = createSignal<Pill>()
  const [card, setCard] = createSignal<Card>()
  let frame = 0

  const read = () => {
    if (card()) return
    const root = props.root()
    const selection = window.getSelection()
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return setPill(undefined)
    if (!inAssistant(root, selection.anchorNode) || !inAssistant(root, selection.focusNode)) return setPill(undefined)
    const text = quoteText(selection.toString())
    if (!text) return setPill(undefined)
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const below = rect.top < 56
    setPill({
      text,
      x: rect.left + rect.width / 2,
      y: below ? rect.bottom + 8 : rect.top - 8,
      top: rect.top,
      bottom: rect.bottom,
      below,
      range: range.cloneRange(),
    })
  }
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(read)
  }
  const hide = () => setPill(undefined)
  const collapse = () => {
    if (pill() && window.getSelection()?.isCollapsed) hide()
  }
  const close = () => {
    setCard(undefined)
    highlightPassage(undefined)
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    if (card()) {
      event.preventDefault()
      return close()
    }
    if (pill()) hide()
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
      highlightPassage(undefined)
    })
  })

  const done = () => {
    hide()
    window.getSelection()?.removeAllRanges()
  }

  const open = (current: Pill) => {
    // The selection goes when focus moves into the card; the highlight keeps the passage marked meanwhile.
    highlightPassage(current.range)
    setCard({ text: current.text, x: current.x, top: current.top, bottom: current.bottom })
    done()
  }

  return (
    <>
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
                data-action="selection-reply"
                class="flex h-8 items-center gap-1.5 rounded-[12px] px-3 text-[13px] font-[500] text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none"
                onClick={() => open(current())}
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
      <Show when={card()} keyed>
        {(current) => (
          <ReplyCard
            card={current}
            onClose={close}
            onFallback={(quote) => {
              close()
              props.onReply(quote)
            }}
          />
        )}
      </Show>
    </>
  )
}

function ReplyCard(props: { card: Card; onClose: () => void; onFallback: (quote: string) => void }) {
  const language = useLanguage()
  let element: HTMLDivElement | undefined
  let field: HTMLTextAreaElement | undefined
  const controller = createComposerController({
    send: (text) => {
      if (!sendReply({ text, quote: props.card.text })) {
        props.onFallback(props.card.text)
        return false
      }
      props.onClose()
      return true
    },
  })
  const place = () => placeReplyCard(props.card, { width: window.innerWidth, height: window.innerHeight })
  const [placement, setPlacement] = createSignal(place())

  onMount(() => {
    requestAnimationFrame(() => field?.focus())
    const resize = () => setPlacement(place())
    // A click elsewhere closes an empty card; a card with a draft stays until it is sent or closed.
    const outside = (event: PointerEvent) => {
      if (element?.contains(event.target as Node)) return
      if (!controller.value().trim()) props.onClose()
    }
    window.addEventListener("resize", resize)
    document.addEventListener("pointerdown", outside, true)
    onCleanup(() => {
      window.removeEventListener("resize", resize)
      document.removeEventListener("pointerdown", outside, true)
    })
  })

  return (
    <Portal>
      <div
        ref={element}
        data-component="selection-reply-card"
        role="dialog"
        aria-label={language.t("secondBrain.quote.replyingTo")}
        class="fixed z-50 animate-enter"
        style={{
          left: `${placement().left}px`,
          top: `${placement().top}px`,
          width: `${placement().width}px`,
          transform: placement().below ? undefined : "translateY(-100%)",
          "transform-origin": placement().below ? "top center" : "bottom center",
        }}
      >
        <ComposerBox
          controller={controller}
          size="medium"
          label={language.t("secondBrain.quote.field")}
          placeholder={language.t("secondBrain.quote.placeholder")}
          sendLabel={language.t("secondBrain.quote.send")}
          ref={(textarea) => (field = textarea)}
          class="!rounded-[18px] !bg-v2-background-bg-floating !shadow-[var(--v2-elevation-floating)]"
          header={
            <div class="flex flex-col gap-1.5 px-2 pt-2">
              <div class="flex items-center gap-1.5 pl-1.5">
                <IconV2 name="reply" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                <span class="flex-1 text-[12px] font-[530] text-v2-text-text-muted">
                  {language.t("secondBrain.quote.replyingTo")}
                </span>
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  aria-label={language.t("secondBrain.quote.close")}
                  icon={<IconV2 name="close" size="small" />}
                  onClick={() => props.onClose()}
                />
              </div>
              <blockquote
                data-slot="reply-passage"
                class="m-0 line-clamp-2 rounded-[12px] bg-v2-background-bg-layer-01 px-2.5 py-2 text-[12.5px] leading-[1.5] text-v2-text-text-muted"
              >
                {props.card.text}
              </blockquote>
            </div>
          }
          controls={
            <span class="pl-1.5 text-[11.5px] text-v2-text-text-faint">{language.t("secondBrain.quote.hint")}</span>
          }
        />
      </div>
    </Portal>
  )
}
