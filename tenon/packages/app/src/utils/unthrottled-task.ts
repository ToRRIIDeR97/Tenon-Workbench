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
