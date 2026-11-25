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

export function motionDuration(name: MotionDuration, element?: Element) {
  if (typeof document === "undefined") return FALLBACK[name]
  return (
    cssDuration(getComputedStyle(element ?? document.documentElement).getPropertyValue(`--v2-duration-${name}`)) ??
    FALLBACK[name]
  )
}

export function cssDuration(value: string) {
  const match = value.trim().match(/^(-?[\d.]+)(ms|s)?$/i)
  if (!match) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return undefined
  return match[2]?.toLowerCase() === "s" ? amount * 1000 : amount
}
