/**
 * Runs `fn` after `ms` on a timer while the page is visible. While it is hidden (the window minimized or behind
 * others) it runs as a message-channel task instead: the browser throttles a hidden page's timers, after a few minutes
 * to about once a minute, so work kept on timers piles up and lands in one burst when the window comes back, which
 * shows as stutter. Message-channel tasks aren't throttled. Returns a function that cancels the task.
 */
export function soon(fn: () => void, ms = 0): () => void {
  if (typeof document === "undefined" || !document.hidden || typeof MessageChannel === "undefined") {
    const timer = setTimeout(fn, ms)
    return () => clearTimeout(timer)
  }
  let cancelled = false
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    channel.port1.close()
    if (!cancelled) fn()
  }
  channel.port2.postMessage(undefined)
  return () => {
    cancelled = true
    channel.port1.close()
  }
}
