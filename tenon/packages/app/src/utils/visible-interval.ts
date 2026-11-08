import { onCleanup } from "solid-js"

const hidden = () => typeof document !== "undefined" && document.hidden

/**
 * Run `tick` every `ms` while the window is visible, and once more as soon as a hidden window is shown again.
 * Call it inside a reactive owner (component body, onMount or createEffect); it stops when that owner is cleaned up.
 */
export function createVisibleInterval(tick: () => void, ms: number) {
  const id = setInterval(() => {
    if (!hidden()) tick()
  }, ms)
  const onVisibility = () => {
    if (!hidden()) tick()
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility)
  onCleanup(() => {
    clearInterval(id)
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility)
  })
}
