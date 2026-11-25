const DEFAULT_PORTS: Record<string, number> = {
  ftp: 21,
  gopher: 70,
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
}

export function getProxyForUrl(input: string | URL) {
  const url = typeof input === "string" ? (URL.canParse(input) ? new URL(input) : undefined) : input
  if (!url) return

  const protocol = url.protocol.split(":", 1)[0]
  const hostname = url.host.replace(/:\d*$/, "")
  const port = Number.parseInt(url.port) || DEFAULT_PORTS[protocol] || 0
  if (!shouldProxy(hostname, port)) return

  const proxy = env(`${protocol}_proxy`) || env("all_proxy")
  if (!proxy) return
  return proxy.includes("://") ? proxy : `${protocol}://${proxy}`
}

function shouldProxy(hostname: string, port: number) {
  const noProxy = env("no_proxy").toLowerCase()
  if (!noProxy) return true
  if (noProxy === "*") return false

  return noProxy.split(/[,\s]/).every((proxy) => {
    if (!proxy) return true

    const parsed = proxy.match(/^(.+):(\d+)$/)
    const proxyHostname = parsed ? parsed[1] : proxy
    const proxyPort = parsed ? Number.parseInt(parsed[2]) : 0
    if (proxyPort && proxyPort !== port) return true

    if (!/^[.*]/.test(proxyHostname)) return hostname !== proxyHostname
    return !hostname.endsWith(proxyHostname.startsWith("*") ? proxyHostname.slice(1) : proxyHostname)
  })
}

function env(key: string) {
  return process.env[key.toLowerCase()] || process.env[key.toUpperCase()] || ""
}

export * as ProxyEnv from "./proxy-env"
