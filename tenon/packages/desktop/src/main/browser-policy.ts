// What the embedded browser may load. Kept apart from browser.ts, which needs Electron at runtime.

// Chromium resolves a trailing dot the same, and any 127.0.0.0/8, unspecified or IPv4-mapped loopback
// address can reach a loopback listener.
const loopbackIPv4 = /^127(?:\.\d{1,3}){3}$/
const loopbackMappedIPv6 = /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/

export function isLocal(url: URL) {
  const host = url.hostname.replace(/\.$/, "").toLowerCase()
  return (
    host === "localhost" ||
    host === "[::1]" ||
    host === "[::]" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    loopbackIPv4.test(host) ||
    loopbackMappedIPv6.test(host)
  )
}

/** Whether a request reaches a blocked origin. Every loopback name for a blocked port is the same server. */
export function isBlockedRequest(url: URL, blocked: ReadonlySet<string>) {
  if (blocked.has(url.origin)) return true
  return isLocal(url) && [...blocked].some((origin) => new URL(origin).port === url.port)
}

/**
 * Whether a page-driven navigation (link, redirect, window.open) needs the user's yes: only while an agent's
 * browser tool is in flight, for a site other than localhost the user has not allowed. A page can wait out
 * the call, so this narrows the gap around the `browser_navigate` dialog rather than closing it.
 */
export function needsAgentConsent(url: URL, agentCalls: number, allowed: ReadonlySet<string>) {
  return agentCalls > 0 && !isLocal(url) && !allowed.has(url.host)
}
