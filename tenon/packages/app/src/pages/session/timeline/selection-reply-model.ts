// Pure helpers for the selection pill and reply card (selection-reply.tsx), kept free of UI imports for tests.

/** Longer passages are cut so a quote can't swamp the message it is attached to. */
export const QUOTE_LIMIT = 2000
export const CARD_WIDTH = 420
const CARD_HEIGHT = 230
const EDGE = 16

/** The text to quote, or undefined when the selection is empty. */
export function quoteText(raw: string) {
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (!text) return
  return text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT).trimEnd()}…` : text
}

/** Where the reply card goes: centred on the selection, kept on screen, below it when it fits and above otherwise. */
export function placeReplyCard(
  selection: { x: number; top: number; bottom: number },
  viewport: { width: number; height: number },
) {
  const width = Math.min(CARD_WIDTH, viewport.width - EDGE * 2)
  const left = Math.min(Math.max(selection.x - width / 2, EDGE), viewport.width - EDGE - width)
  const below = selection.bottom + 8 + CARD_HEIGHT <= viewport.height - EDGE || selection.top - 8 - CARD_HEIGHT < EDGE
  return below
    ? { left, width, top: Math.min(selection.bottom + 8, viewport.height - EDGE - CARD_HEIGHT), below }
    : { left, width, top: selection.top - 8, below }
}
