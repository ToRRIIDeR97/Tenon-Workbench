// Shared runtime reads of the Material 3 motion tokens in v2/styles/theme.css, for JS that has to time
// work against a CSS animation (dispose after an exit, fall back when an animation event never fires).

const FALLBACK = {
  short: 150,
  medium: 300,
  long: 450,
  exit: 200,
  "exit-small": 120,
  "swap-out": 100,
  "swap-in": 200,
}

export type MotionDuration = keyof typeof FALLBACK

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
}

/** `--v2-duration-<name>` in milliseconds, read from `element` (default: the root element). */
export function motionDuration(name: MotionDuration, element?: Element) {
  if (typeof document === "undefined") return FALLBACK[name]
  return (
    cssDuration(getComputedStyle(element ?? document.documentElement).getPropertyValue(`--v2-duration-${name}`)) ??
    FALLBACK[name]
  )
}

/**
 * A CSS time in milliseconds. The production build minifies `200ms` to `.2s`, so seconds must be read as such:
 * taking `.2s` as 0.2 ms disposed every exit after one frame in the packaged app.
 */
export function cssDuration(value: string) {
  const match = value.trim().match(/^(-?[\d.]+)(ms|s)?$/i)
  if (!match) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return undefined
  return match[2]?.toLowerCase() === "s" ? amount * 1000 : amount
}
