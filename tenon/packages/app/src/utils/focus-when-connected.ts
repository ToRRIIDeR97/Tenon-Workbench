export function focusWhenConnected(element: HTMLElement, options: FocusOptions = { preventScroll: true }, frames = 30) {
  const attempt = (left: number) => {
    if (element.isConnected) {
      element.focus(options)
      return
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1))
  }
  queueMicrotask(() => attempt(frames))
}
