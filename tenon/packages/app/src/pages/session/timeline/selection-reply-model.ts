export const QUOTE_LIMIT = 2000
export const CARD_WIDTH = 400
const CARD_HEIGHT = 140
const EDGE = 16

export function quoteText(raw: string) {
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (!text) return
  return text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT).trimEnd()}…` : text
}

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
