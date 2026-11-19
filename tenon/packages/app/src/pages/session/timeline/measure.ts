/**
 * Measures `element` in a microtask, so content that just mounted (an opened card) is measured in the same frame
 * as it renders instead of a frame later behind its old, clipped height (#327). Returns a cancel function.
 */
export function scheduleConnectedMeasure<T extends HTMLElement>(element: T, measure: (element: T) => void) {
  let cancelled = false
  queueMicrotask(() => {
    if (!cancelled && element.isConnected) measure(element)
  })
  return () => {
    cancelled = true
  }
}
