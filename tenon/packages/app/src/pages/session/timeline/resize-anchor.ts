export const TOGGLE_HOLD_MS = 800

export function resizeAnchoring(input: { following: boolean; sinceToggleMs: number }) {
  const holdEnd = input.following && input.sinceToggleMs >= TOGGLE_HOLD_MS
  return { holdEnd, scrollToEnd: holdEnd }
}
