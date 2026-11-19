/** How long after a card was opened or closed its resize counts as the user's, not the stream's. */
export const TOGGLE_HOLD_MS = 800

/**
 * Who keeps the timeline in place when a row resizes (#327). While the timeline follows the bottom, the end stays
 * anchored and one scroll to the end follows. Just after a card was toggled the card grows below its header, so
 * neither the end anchor nor a scroll to the end may move the view; a timeline that isn't following never scrolls.
 */
export function resizeAnchoring(input: { following: boolean; sinceToggleMs: number }) {
  const holdEnd = input.following && input.sinceToggleMs >= TOGGLE_HOLD_MS
  return { holdEnd, scrollToEnd: holdEnd }
}
