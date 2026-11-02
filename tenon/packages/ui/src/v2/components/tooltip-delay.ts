// One timing rule for every app tooltip: wait before the first one opens, then open the
// next one at once while the pointer moves between triggers.
export const TOOLTIP_OPEN_DELAY = 400
export const TOOLTIP_SKIP_WINDOW = 400

export function tooltipOpenDelay(lastClosedAt: number | undefined, now: number) {
  if (lastClosedAt === undefined) return TOOLTIP_OPEN_DELAY
  if (now - lastClosedAt < TOOLTIP_SKIP_WINDOW) return 0
  return TOOLTIP_OPEN_DELAY
}
