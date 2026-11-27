export function testEndpoints(env: Readonly<Record<string, string | undefined>>, packaged: boolean) {
  if (packaged) return undefined
  const oauth = loopback(env.TENON_THREAD_SYNC_OAUTH_ENDPOINT)
  const drive = loopback(env.TENON_THREAD_SYNC_DRIVE_ENDPOINT)
  if (!oauth && !drive) return undefined
  return {
    oauth: oauth ? { authorize: `${oauth}/authorize`, token: `${oauth}/token`, revoke: `${oauth}/revoke` } : undefined,
    drive,
  }
}

function loopback(value: string | undefined) {
  if (!value) return undefined
  const url = URL.parse(value)
  if (!url || url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return undefined
  return url.origin
}
