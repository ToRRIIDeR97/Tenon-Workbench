type Stored = { bytes: Uint8Array; generation: number }

export function fakeGcs(options: { pageSize?: number; token?: string } = {}) {
  const objects = new Map<string, Stored>()
  const requests: Array<{ method: string; path: string; search: string }> = []
  const state = { generation: 1000, failNext: 0 }
  const token = options.token ?? "test-token"
  const pageSize = options.pageSize ?? 1000
  const refuse = (status: number, message: string) => Response.json({ error: { code: status, message } }, { status })

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      requests.push({ method: request.method, path: url.pathname, search: url.search })
      if (state.failNext > 0) {
        state.failNext -= 1
        return refuse(503, "backend unavailable")
      }
      if (request.headers.get("authorization") !== `Bearer ${token}`) return refuse(401, "invalid credentials")

      const upload = url.pathname.match(/^\/upload\/storage\/v1\/b\/([^/]+)\/o$/)
      if (upload && request.method === "POST") {
        const name = url.searchParams.get("name")
        if (!name || url.searchParams.get("uploadType") !== "media") return refuse(400, "media upload with a name expected")
        const key = `${upload[1]}/${name}`
        const wanted = url.searchParams.get("ifGenerationMatch")
        if (wanted !== null && Number(wanted) !== (objects.get(key)?.generation ?? 0)) return refuse(412, "conditionNotMet")
        const bytes = new Uint8Array(await request.arrayBuffer())
        state.generation += 1
        objects.set(key, { bytes, generation: state.generation })
        return Response.json({
          kind: "storage#object",
          bucket: upload[1],
          name,
          generation: String(state.generation),
          size: String(bytes.length),
        })
      }

      const listing = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o$/)
      if (listing && request.method === "GET") {
        const prefix = `${listing[1]}/${url.searchParams.get("prefix") ?? ""}`
        const names = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()
        const start = Number(url.searchParams.get("pageToken") ?? "0")
        const page = names.slice(start, start + pageSize)
        return Response.json({
          kind: "storage#objects",
          items: page.map((key) => ({
            name: key.slice(listing[1].length + 1),
            generation: String(objects.get(key)!.generation),
            size: String(objects.get(key)!.bytes.length),
          })),
          ...(start + pageSize < names.length ? { nextPageToken: String(start + pageSize) } : {}),
        })
      }

      const object = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/)
      if (object) {
        if (object[2].includes("/")) return refuse(404, "object names must be percent-encoded")
        const key = `${object[1]}/${decodeURIComponent(object[2])}`
        const stored = objects.get(key)
        if (!stored) return refuse(404, "No such object")
        if (request.method === "DELETE") {
          objects.delete(key)
          return new Response(null, { status: 204 })
        }
        if (request.method === "GET" && url.searchParams.get("alt") === "media")
          return new Response(stored.bytes, {
            headers: { "x-goog-generation": String(stored.generation), "content-type": "application/octet-stream" },
          })
        if (request.method === "GET")
          return Response.json({
            name: decodeURIComponent(object[2]),
            generation: String(stored.generation),
            size: String(stored.bytes.length),
          })
      }
      return refuse(404, "not found")
    },
  })

  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    token,
    objects,
    requests,
    failNext: (count: number) => {
      state.failNext = count
    },
    stop: () => server.stop(true),
  }
}
