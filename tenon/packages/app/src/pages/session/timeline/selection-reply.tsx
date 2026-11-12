import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon as IconV2 } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { ComposerBox } from "@/components/prompt-input/composer-box"
import { createComposerController } from "@/components/prompt-input/composer-controller"
import { addReply, sendReply } from "@/components/prompt-input/reply-bridge"
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
type Rect = { left: number; top: number; width: number; height: number }
type Card = { text: string; x: number; top: number; bottom: number; from?: Rect }

/**
 * A Reply pill over text selected in an assistant reply. Reply grows the pill into a card: the passage, a text box
 * with dictation, and Send, which posts a new message quoting the passage through the thread composer. Copy copies
 * the passage. The card grows out of the pill and shrinks back into it when closed. The pill follows the selection and goes when it collapses, on scroll or on Escape; the card stays
 * until it is sent, closed, or Escape is pressed (or a click lands outside it while it is empty).
 * `onReply` is the fallback when no thread composer is mounted to send through: the passage becomes a quote there.
 */
export function SelectionReply(props: { root: () => HTMLElement | undefined; onReply: (text: string) => void }) {
  const language = useLanguage()
  const [pill, setPill] = createSignal<Pill>()
  const [card, setCard] = createSignal<Card>()
  let frame = 0
  let pillElement: HTMLDivElement | undefined

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
    // The open card handles its own Escape, so it can shrink back into the pill first.
    if (card()) return
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
    const from = pillElement?.getBoundingClientRect()
    setCard({
      text: current.text,
      x: current.x,
      top: current.top,
      bottom: current.bottom,
      from: from && { left: from.left, top: from.top, width: from.width, height: from.height },
    })
    done()
  }

  return (
    <>
      <Show when={pill()}>
        {(current) => (
          <Portal>
            <div
              ref={pillElement}
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
  let leaving = false
  const controller = createComposerController({
    send: (text) => {
      if (!sendReply({ text, quote: props.card.text })) {
        props.onFallback(props.card.text)
        return false
      }
      dismiss("sent")
      return true
    },
  })
  // Enter keeps the reply as a chip in the composer, to send with the draft; Ctrl/⌘+Enter (or Send) posts it now.
  const add = () => {
    if (leaving) return
    if (!addReply({ text: controller.value(), quote: props.card.text })) return props.onFallback(props.card.text)
    dismiss("added")
  }
  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return false
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) void controller.send()
    else add()
    return true
  }
  // Closing shrinks the card back into the pill's place, adding flies it into the composer, and a sent reply fades
  // out where it is.
  const dismiss = (reason: "closed" | "sent" | "added") => {
    if (leaving) return
    leaving = true
    const animation = element && !reducedMotion() ? leave(element, props.card.from, reason) : undefined
    if (!animation) return props.onClose()
    animation.finished.then(props.onClose, props.onClose)
  }
  const place = () => placeReplyCard(props.card, { width: window.innerWidth, height: window.innerHeight })
  const [placement, setPlacement] = createSignal(place())

  onMount(() => {
    if (element && !reducedMotion()) grow(element, props.card.from)
    // Focus at once: the first keystroke after Reply belongs in the card, not wherever focus was.
    field?.focus({ preventScroll: true })
    const resize = () => setPlacement(place())
    // A click elsewhere closes an empty card; a card with a draft stays until it is sent or closed.
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && element?.contains(event.target)) return
      if (!controller.value().trim()) dismiss("closed")
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      dismiss("closed")
    }
    window.addEventListener("resize", resize)
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("keydown", escape)
    onCleanup(() => {
      window.removeEventListener("resize", resize)
      document.removeEventListener("pointerdown", outside, true)
      document.removeEventListener("keydown", escape)
    })
  })

  return (
    <Portal>
      <div
        ref={element}
        data-component="selection-reply-card"
        role="dialog"
        aria-label={language.t("secondBrain.quote.replyingTo")}
        class="fixed z-50"
        style={{
          left: `${placement().left}px`,
          top: `${placement().top}px`,
          width: `${placement().width}px`,
          // `translate`, not `transform`: the grow and shrink animations drive `transform`.
          translate: placement().below ? undefined : "0 -100%",
        }}
      >
        <ComposerBox
          controller={controller}
          size="medium"
          label={language.t("secondBrain.quote.field")}
          placeholder={language.t("secondBrain.quote.placeholder", {
            mod: navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl",
          })}
          sendLabel={language.t("secondBrain.quote.send")}
          ref={(textarea) => (field = textarea)}
          onKeyDown={keyDown}
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
                  onClick={() => dismiss("closed")}
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
        />
      </div>
    </Portal>
  )
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
/** Room around the card that the clip keeps once open, so its shadow isn't cut off. */
const SHADOW_ROOM = 40

/** The clip and offset that make the card look exactly like the pill: same box, same place, same corners. */
function pillShape(card: DOMRect, pill: Rect) {
  const x = pill.left + pill.width / 2 - (card.left + card.width / 2)
  const y = pill.top + pill.height / 2 - (card.top + card.height / 2)
  const insetX = Math.max(0, (card.width - pill.width) / 2)
  const insetY = Math.max(0, (card.height - pill.height) / 2)
  return {
    transform: `translate(${x}px, ${y}px)`,
    clipPath: `inset(${insetY}px ${insetX}px round 16px)`,
  }
}

const OPEN_SHAPE = {
  transform: "translate(0px, 0px)",
  clipPath: `inset(-${SHADOW_ROOM}px round ${18 + SHADOW_ROOM}px)`,
}

function contents(element: HTMLElement) {
  return [...(element.querySelector('[data-component="composer-box"]')?.children ?? [])]
}

/** The card's surface grows out of the pill while its contents fade in once there is room for them. */
function grow(element: HTMLElement, from: Rect | undefined) {
  if (!from) {
    element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" })
    return
  }
  element.animate([pillShape(element.getBoundingClientRect(), from), OPEN_SHAPE], {
    duration: 300,
    easing: "cubic-bezier(0.05, 0.7, 0.1, 1)",
  })
  for (const child of contents(element))
    child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 90, easing: "ease-out", fill: "backwards" })
}

/** Closing reverses the grow; adding flies the card into the composer's chips; a sent reply fades in place. */
function leave(element: HTMLElement, from: Rect | undefined, reason: "closed" | "sent" | "added") {
  const accelerate = "cubic-bezier(0.3, 0, 0.8, 0.15)"
  const composer = document.querySelector('[data-component="prompt-input"]')?.getBoundingClientRect()
  if (reason === "added" && composer) {
    const card = element.getBoundingClientRect()
    // The chip strip sits at the composer's top-left, just above the text.
    const x = composer.left + 12 - card.left
    const y = composer.top - 44 - card.top
    return element.animate(
      [
        { transform: "translate(0px, 0px) scale(1)", opacity: 1, transformOrigin: "top left" },
        { transform: `translate(${x}px, ${y}px) scale(0.4)`, opacity: 0, transformOrigin: "top left" },
      ],
      { duration: 300, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
    )
  }
  if (reason === "sent" || !from)
    return element.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.98)" },
      ],
      { duration: 150, easing: accelerate, fill: "forwards" },
    )
  for (const child of contents(element))
    child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: "forwards" })
  return element.animate([OPEN_SHAPE, { ...pillShape(element.getBoundingClientRect(), from), opacity: 0 }], {
    duration: 200,
    easing: accelerate,
    fill: "forwards",
  })
}
