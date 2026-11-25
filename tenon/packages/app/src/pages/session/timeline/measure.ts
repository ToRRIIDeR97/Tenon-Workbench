export function scheduleConnectedMeasure<T extends HTMLElement>(element: T, measure: (element: T) => void) {
  let cancelled = false
  queueMicrotask(() => {
    if (!cancelled && element.isConnected) measure(element)
  })
  return () => {
    cancelled = true
  }
}
