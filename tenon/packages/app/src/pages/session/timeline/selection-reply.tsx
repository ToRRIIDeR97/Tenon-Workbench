import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import createPresence from "solid-presence"
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
/** `from` is the pill and `label` its Reply button, which the card grows out of. */
type Card = { text: string; below: boolean; from: Rect; label?: Rect }

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
  // The pill fades out where it was when the selection goes, so it keeps the last selection while it leaves. Opening
  // the card skips the fade: the card grows out of the pill instead.
  const [pillNode, setPillNode] = createSignal<HTMLDivElement | null>(null)
  const [shownPill, setShownPill] = createSignal<Pill>()
  createEffect(() => {
    const current = pill()
    if (current) setShownPill(current)
  })
  const presence = createPresence({ show: () => !!pill(), element: pillNode })

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
    if (!from) return
    const label = pillElement?.querySelector('[data-action="selection-reply"]')?.getBoundingClientRect()
    setCard({
      text: current.text,
      below: current.below,
      from: rect(from),
      label: label && rect(label),
    })
    done()
  }

  return (
    <>
      <Show when={presence.present() ? shownPill() : undefined}>
        {(current) => (
          <Portal>
            <div
              ref={(element) => {
                pillElement = element
                setPillNode(element)
              }}
              data-component="selection-reply"
              role="toolbar"
              aria-label={language.t("secondBrain.quote.toolbar")}
              class="fixed z-50 flex gap-0.5 rounded-[16px] bg-v2-background-bg-floating p-1 shadow-[var(--v2-elevation-floating)]"
              classList={{
                "animate-enter": !!pill(),
                "animate-exit pointer-events-none": !pill() && !card(),
              }}
              style={{
                left: `${current().x}px`,
                top: `${current().y}px`,
                // `translate`, not `transform`: the enter animation drives `transform` and would undo the centring.
                translate: current().below ? "-50% 0" : "-50% -100%",
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
    const animation = element && !reducedMotion() ? leave(element, props.card, reason) : undefined
    if (!animation) return props.onClose()
    animation.finished.then(props.onClose, props.onClose)
  }
  const place = () =>
    placeReplyCard(
      {
        left: props.card.from.left,
        top: props.card.from.top,
        bottom: props.card.from.top + props.card.from.height,
        below: props.card.below,
      },
      { width: window.innerWidth, height: window.innerHeight },
    )
  const [placement, setPlacement] = createSignal(place())

  onMount(() => {
    if (element && !reducedMotion()) grow(element, props.card)
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
        {/* The pill stretched: its Reply label and one line of the passage on top, the text box and Send below. */}
        <ComposerBox
          controller={controller}
          size="compact"
          label={language.t("secondBrain.quote.field")}
          placeholder={language.t("secondBrain.quote.placeholder", {
            mod: navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl",
          })}
          sendLabel={language.t("secondBrain.quote.send")}
          ref={(textarea) => (field = textarea)}
          onKeyDown={keyDown}
          class="!flex-wrap !items-end !gap-0.5 !rounded-[20px] !p-1 !bg-v2-background-bg-floating !shadow-[var(--v2-elevation-floating)]"
          header={
            <div data-slot="reply-header" class="flex min-w-0 basis-full items-center gap-0.5">
              <span
                data-slot="reply-label"
                class="flex h-8 shrink-0 items-center gap-1.5 px-3 text-[13px] font-[500] text-v2-text-text-muted"
              >
                <IconV2 name="reply" class="shrink-0" />
                {language.t("secondBrain.quote.reply")}
              </span>
              <blockquote
                data-slot="reply-passage"
                title={props.card.text}
                class="m-0 min-w-0 flex-1 truncate text-[12.5px] text-v2-text-text-faint"
              >
                {props.card.text}
              </blockquote>
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                size="normal"
                aria-label={language.t("secondBrain.quote.close")}
                icon={<IconV2 name="close" size="small" />}
                onClick={() => dismiss("closed")}
              />
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
const EMPHASIZED = "cubic-bezier(0.05, 0.7, 0.1, 1)"
const ACCELERATE = "cubic-bezier(0.3, 0, 0.8, 0.15)"

function rect(box: DOMRect): Rect {
  return { left: box.left, top: box.top, width: box.width, height: box.height }
}

/**
 * The clip and offset that make the card look exactly like the pill. The card opens from the pill's corner, so the
 * clip alone usually does it; the offset covers what the clip can't reach when the card was pushed aside to fit.
 */
function pillShape(card: DOMRect, pill: Rect) {
  const top = Math.min(Math.max(pill.top - card.top, 0), Math.max(card.height - pill.height, 0))
  const left = Math.min(Math.max(pill.left - card.left, 0), Math.max(card.width - pill.width, 0))
  const x = pill.left - card.left - left
  const y = pill.top - card.top - top
  const right = Math.max(card.width - left - pill.width, 0)
  const bottom = Math.max(card.height - top - pill.height, 0)
  return {
    x,
    y,
    transform: `translate(${x}px, ${y}px)`,
    clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round 16px)`,
  }
}

const OPEN_SHAPE = {
  transform: "translate(0px, 0px)",
  clipPath: `inset(-${SHADOW_ROOM}px round ${20 + SHADOW_ROOM}px)`,
}

const LABEL = '[data-slot="reply-label"]'

/** Everything in the card except the Reply label, which is the pill's own and never fades. */
function contents(element: HTMLElement) {
  return [...(element.querySelector('[data-component="composer-box"]')?.children ?? [])].flatMap((child) =>
    child.matches('[data-slot="reply-header"]') ? [...child.children].filter((item) => !item.matches(LABEL)) : [child],
  )
}

/** Where the card's Reply label sits relative to the pill's, once the card has the pill's shape. */
function labelOffset(element: HTMLElement, card: Card, shape: { x: number; y: number }) {
  const label = element.querySelector(LABEL)?.getBoundingClientRect()
  if (!label || !card.label) return
  return `translate(${card.label.left - label.left - shape.x}px, ${card.label.top - label.top - shape.y}px)`
}

/**
 * The pill stretches into the card: its surface grows from the pill's corner, its Reply label slides into place,
 * and the rest fades in once there is room for it.
 */
function grow(element: HTMLElement, card: Card) {
  const shape = pillShape(element.getBoundingClientRect(), card.from)
  element.animate([{ transform: shape.transform, clipPath: shape.clipPath }, OPEN_SHAPE], {
    duration: 320,
    easing: EMPHASIZED,
  })
  const offset = labelOffset(element, card, shape)
  if (offset)
    element
      .querySelector(LABEL)
      ?.animate([{ transform: offset, color: "var(--v2-text-text-base)" }, { transform: "translate(0px, 0px)" }], {
        duration: 320,
        easing: EMPHASIZED,
      })
  for (const child of contents(element))
    child.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
      delay: 110,
      easing: "ease-out",
      fill: "backwards",
    })
}

/** Closing shrinks the card back into the pill; adding flies it into the composer's chips; a sent reply fades. */
function leave(element: HTMLElement, card: Card, reason: "closed" | "sent" | "added") {
  const composer = document.querySelector('[data-component="prompt-input"]')?.getBoundingClientRect()
  if (reason === "added" && composer) {
    const box = element.getBoundingClientRect()
    // The chip strip sits at the composer's top-left, just above the text.
    const x = composer.left + 12 - box.left
    const y = composer.top - 44 - box.top
    return element.animate(
      [
        { transform: "translate(0px, 0px) scale(1)", opacity: 1, transformOrigin: "top left" },
        { transform: `translate(${x}px, ${y}px) scale(0.4)`, opacity: 0, transformOrigin: "top left" },
      ],
      { duration: 300, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
    )
  }
  if (reason === "sent")
    return element.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.98)" },
      ],
      { duration: 150, easing: ACCELERATE, fill: "forwards" },
    )
  for (const child of contents(element))
    child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: "forwards" })
  const shape = pillShape(element.getBoundingClientRect(), card.from)
  const offset = labelOffset(element, card, shape)
  if (offset)
    element.querySelector(LABEL)?.animate([{ transform: "translate(0px, 0px)" }, { transform: offset }], {
      duration: 220,
      easing: ACCELERATE,
      fill: "forwards",
    })
  return element.animate([OPEN_SHAPE, { transform: shape.transform, clipPath: shape.clipPath, opacity: 0 }], {
    duration: 220,
    easing: ACCELERATE,
    fill: "forwards",
  })
}
