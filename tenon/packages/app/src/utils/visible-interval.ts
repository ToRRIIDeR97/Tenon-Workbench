import { onCleanup } from "solid-js"

const hidden = () => typeof document !== "undefined" && document.hidden

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
