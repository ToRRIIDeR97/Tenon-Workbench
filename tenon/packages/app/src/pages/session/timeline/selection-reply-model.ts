// Pure helpers for the selection pill and reply card (selection-reply.tsx), kept free of UI imports for tests.

/** Longer passages are cut so a quote can't swamp the message it is attached to. */
export const QUOTE_LIMIT = 2000
export const CARD_WIDTH = 400
/** Room the card needs, with a few lines of reply, to open on a side of the pill. */
const CARD_HEIGHT = 140
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

/**
 * Where the reply card goes: it grows out of the pill from the pill's own corner, away from the selection, so the
 * passage stays visible. A pill above the selection grows the card upward from its bottom edge (`top` is then the
 * card's bottom, `below` false); a pill under it grows the card downward from its top edge. When that side has no
 * room the card grows the other way. It stays on screen sideways.
 */
export function placeReplyCard(
  pill: { left: number; top: number; bottom: number; below: boolean },
  viewport: { width: number; height: number },
) {
  const width = Math.min(CARD_WIDTH, viewport.width - EDGE * 2)
  const left = Math.min(Math.max(pill.left, EDGE), viewport.width - EDGE - width)
  const roomAbove = pill.bottom - CARD_HEIGHT >= EDGE
  const roomBelow = pill.top + CARD_HEIGHT <= viewport.height - EDGE
  const below = pill.below ? roomBelow || !roomAbove : !roomAbove && roomBelow
  return below ? { left, width, top: pill.top, below } : { left, width, top: pill.bottom, below }
}
