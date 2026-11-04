// What the embedded browser may load. Kept apart from browser.ts, which needs Electron at runtime.

export const isLocal = (url: URL) =>
  ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname) || url.hostname.endsWith(".localhost")

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
