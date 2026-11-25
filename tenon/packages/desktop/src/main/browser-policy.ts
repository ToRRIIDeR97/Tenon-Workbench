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

export function isBlockedRequest(url: URL, blocked: ReadonlySet<string>) {
  if (blocked.has(url.origin)) return true
  return isLocal(url) && [...blocked].some((origin) => new URL(origin).port === url.port)
}

export function needsAgentConsent(url: URL, agentCalls: number, allowed: ReadonlySet<string>) {
  return agentCalls > 0 && !isLocal(url) && !allowed.has(url.host)
}
