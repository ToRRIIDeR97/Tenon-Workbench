export * as ServerNetworkGuard from "./network-guard"

const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

export function isLoopback(hostname: string) {
  return loopback.has(hostname.toLowerCase()) || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

export function assertExposureAllowed(hostname: string, password: string | undefined) {
  if (isLoopback(hostname) || password) return
  throw new Error(
    `Refusing to listen on ${hostname} without authentication; set TENON_SERVER_PASSWORD or use 127.0.0.1.`,
  )
}

export function isAllowedHost(host: string | undefined, listening: string) {
  if (!host) return true
  const hostname = URL.parse(`http://${host}`)?.hostname
  if (!hostname) return false
  const bare = hostname.replace(/^\[(.*)\]$/, "$1")
  return isLoopback(bare) || bare === listening.toLowerCase().replace(/^\[(.*)\]$/, "$1")
}
