type DriveFile = {
  id: string
  name: string
  mimeType: string
  parents: string[]
  appProperties: Record<string, string>
  bytes: Uint8Array
  createdTime: string
  trashed: boolean
  byApp: boolean
}

type Fault = { status: number; reason?: string; method?: string; path?: RegExp }

const FOLDER = "application/vnd.google-apps.folder"

export function fakeDrive(options: { pageSize?: number; token?: string } = {}) {
  const files = new Map<string, DriveFile>()
  const requests: Array<{ method: string; path: string; search: string; q?: string; authorization?: string }> = []
  const state = {
    clock: Date.parse("2026-11-27T09:00:00.000Z"),
    ids: 0,
    faults: [] as Fault[],
    holds: [] as Array<{ arrived: () => void; gate: Promise<void> }>,
    loseReplies: 0,
    stale: 0,
    repeatToken: false,
    malformed: [] as Array<"list" | "create" | "media">,
    incomplete: false,
  }
  const token = options.token ?? "drive-test-token"
  const pageSize = options.pageSize ?? 1000
  const refuse = (status: number, reason: string, message = reason) =>
    Response.json({ error: { code: status, message, errors: [{ domain: "global", reason, message }] } }, { status })

  const nextId = () => {
    state.ids += 1
    return `f${String(state.ids).padStart(6, "0")}x${Math.random().toString(36).slice(2, 8)}`
  }
  const nextTime = () => {
    state.clock += 1
    return new Date(state.clock).toISOString()
  }
  const describe = (file: DriveFile) => ({
    kind: "drive#file",
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    appProperties: file.appProperties,
    createdTime: file.createdTime,
    trashed: file.trashed,
    ...(file.mimeType === FOLDER ? {} : { size: String(file.bytes.length) }),
  })
  const isTrashed = (file: DriveFile): boolean =>
    file.trashed || file.parents.some((parent) => files.get(parent) !== undefined && isTrashed(files.get(parent)!))

  const matcher = (q: string) => {
    const tests: Array<(file: DriveFile) => boolean> = []
    const rest = q
      .replace(/appProperties has \{ key='([^']*)' and value='([^']*)' \}/g, (_, key: string, value: string) => {
        tests.push((file) => file.appProperties[key] === value)
        return "#"
      })
      .replace(/trashed = (true|false)/g, (_, value: string) => {
        tests.push((file) => isTrashed(file) === (value === "true"))
        return "#"
      })
      .replace(/mimeType (=|!=) '([^']*)'/g, (_, operator: string, value: string) => {
        tests.push((file) => (file.mimeType === value) === (operator === "="))
        return "#"
      })
      .replace(/'([^']+)' in parents/g, (_, parent: string) => {
        tests.push((file) => file.parents.includes(parent))
        return "#"
      })
    if (
      rest
        .replace(/#/g, "")
        .replace(/\band\b/g, "")
        .trim() !== ""
    )
      return undefined
    return (file: DriveFile) => tests.every((test) => test(file))
  }

  const multipart = async (request: Request) => {
    const boundary = /boundary=([^;]+)/.exec(request.headers.get("content-type") ?? "")?.[1]
    if (!boundary || !(request.headers.get("content-type") ?? "").startsWith("multipart/related")) return undefined
    const body = Buffer.from(await request.arrayBuffer())
    const marker = Buffer.from(`--${boundary}`)
    if (body.indexOf(marker) !== 0) return undefined
    const collect = (at: number, found: Buffer[]): Buffer[] | undefined => {
      if (body.subarray(at, at + 2).toString() === "--") return found
      const next = body.indexOf(marker, at)
      if (next < 0) return undefined
      return collect(next + marker.length, [...found, body.subarray(at + 2, next - 2)])
    }
    const parts = collect(marker.length, [])
    if (!parts || parts.length !== 2) return undefined
    const split = (part: Buffer) => {
      const end = part.indexOf("\r\n\r\n")
      return { headers: part.subarray(0, end).toString().toLowerCase(), content: part.subarray(end + 4) }
    }
    const metadata = split(parts[0])
    const media = split(parts[1])
    if (!metadata.headers.includes("content-type: application/json")) return undefined
    return { metadata: JSON.parse(metadata.content.toString()) as Record<string, unknown>, bytes: media.content }
  }

  const store = (input: Record<string, unknown>, bytes: Uint8Array, byApp: boolean) => {
    const file: DriveFile = {
      id: nextId(),
      name: typeof input.name === "string" ? input.name : "Untitled",
      mimeType: typeof input.mimeType === "string" ? input.mimeType : "application/octet-stream",
      parents: Array.isArray(input.parents) ? (input.parents as string[]) : ["root"],
      appProperties: (input.appProperties as Record<string, string> | undefined) ?? {},
      bytes: Uint8Array.from(bytes),
      createdTime: nextTime(),
      trashed: false,
      byApp,
    }
    files.set(file.id, file)
    return file
  }

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      requests.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        q: url.searchParams.get("q") ?? undefined,
        authorization: request.headers.get("authorization") ?? undefined,
      })
      const fault = state.faults.findIndex(
        (item) =>
          (item.method === undefined || item.method === request.method) &&
          (item.path === undefined || item.path.test(url.pathname)),
      )
      if (fault >= 0) {
        const [found] = state.faults.splice(fault, 1)
        return refuse(found.status, found.reason ?? "backendError")
      }
      if (request.headers.get("authorization") !== `Bearer ${token}`) return refuse(401, "authError")

      if (url.pathname === "/upload/drive/v3/files" && request.method === "POST") {
        if (url.searchParams.get("uploadType") !== "multipart") return refuse(400, "badRequest", "multipart expected")
        const hold = state.holds.shift()
        if (hold) {
          hold.arrived()
          await hold.gate
        }
        const parsed = await multipart(request)
        if (!parsed) return refuse(400, "badRequest", "a multipart/related body expected")
        const parents = parsed.metadata.parents
        if (Array.isArray(parents) && parents.some((parent) => !files.has(parent) && parent !== "root"))
          return refuse(404, "notFound", "File not found")
        const file = store(parsed.metadata, parsed.bytes, true)
        if (state.loseReplies > 0) {
          state.loseReplies -= 1
          return refuse(503, "backendError")
        }
        if (state.malformed[0] === "create") {
          state.malformed.shift()
          return new Response("{ not json", { status: 200 })
        }
        return Response.json(describe(file))
      }

      if (url.pathname === "/drive/v3/files" && request.method === "POST") {
        const metadata = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined
        if (!metadata || metadata.mimeType !== FOLDER) return refuse(400, "badRequest", "only folders here")
        return Response.json(describe(store(metadata, new Uint8Array(), true)))
      }

      if (url.pathname === "/drive/v3/files" && request.method === "GET") {
        if (url.searchParams.get("spaces") !== "drive") return refuse(400, "badRequest", "spaces=drive expected")
        const test = matcher(url.searchParams.get("q") ?? "")
        if (!test) return refuse(400, "invalid", "Invalid Value")
        if (state.malformed[0] === "list") {
          state.malformed.shift()
          return new Response("<html>not json</html>", { status: 200 })
        }
        const visible = [...files.values()].filter((file) => file.byApp && test(file))
        const hidden =
          state.stale > 0 ? visible.toSorted((a, b) => (a.createdTime < b.createdTime ? 1 : -1))[0] : undefined
        if (state.stale > 0) state.stale -= 1
        const matching = visible.filter((file) => file !== hidden).sort((a, b) => (a.id < b.id ? -1 : 1))
        const size = Math.min(pageSize, Number(url.searchParams.get("pageSize") ?? "100"))
        const start = Number(url.searchParams.get("pageToken") ?? "0")
        const page = matching.slice(start, start + size)
        const more = start + size < matching.length
        return Response.json({
          kind: "drive#fileList",
          ...(state.incomplete ? { incompleteSearch: true } : {}),
          files: page.map(describe),
          ...(more ? { nextPageToken: state.repeatToken ? "0" : String(start + size) } : {}),
        })
      }

      const one = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)
      if (one) {
        const file = files.get(decodeURIComponent(one[1]))
        if (!file || !file.byApp) return refuse(404, "notFound", "File not found")
        if (request.method === "DELETE") {
          files.delete(file.id)
          return new Response(null, { status: 204 })
        }
        if (request.method === "GET" && url.searchParams.get("alt") === "media") {
          if (state.malformed[0] === "media") {
            state.malformed.shift()
            return new Response("short", { status: 200 })
          }
          return new Response(Uint8Array.from(file.bytes), { headers: { "content-type": file.mimeType } })
        }
        if (request.method === "GET") return Response.json(describe(file))
        return refuse(403, "forbidden", "This fake refuses changes to an existing file")
      }
      return refuse(404, "notFound", "Unknown route")
    },
  })

  const versions = (name: string) => {
    const parts = name.split("/")
    const base = parts.at(-1)
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "."
    return [...files.values()].filter(
      (file) => file.byApp && file.appProperties.dir === dir && file.appProperties.base === base && !isTrashed(file),
    )
  }

  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    token,
    files,
    requests,
    folders: () =>
      [...files.values()].filter((file) => file.mimeType === FOLDER && file.appProperties.tenonSync === "folder-v1"),
    versions,
    fail: (count: number, fault: Fault) => {
      state.faults.push(...Array.from({ length: count }, () => fault))
    },
    clearFaults: () => {
      state.faults = []
    },
    holdNextCreate: () => {
      const signals: { arrived?: () => void; release?: () => void } = {}
      const arrived = new Promise<void>((resolve) => {
        signals.arrived = resolve
      })
      const gate = new Promise<void>((resolve) => {
        signals.release = resolve
      })
      state.holds.push({ arrived: () => signals.arrived?.(), gate })
      return { arrived, release: () => signals.release?.() }
    },
    loseCreateReplies: (count: number) => {
      state.loseReplies = count
    },
    staleListings: (count: number) => {
      state.stale = count
    },
    repeatPageToken: (on: boolean) => {
      state.repeatToken = on
    },
    malformedNext: (kind: "list" | "create" | "media") => {
      state.malformed.push(kind)
    },
    incompleteSearch: (on: boolean) => {
      state.incomplete = on
    },
    seedFolder: (name: string) =>
      store({ name, mimeType: FOLDER, appProperties: { tenonSync: "folder-v1" } }, new Uint8Array(), true),
    user: {
      rename: (id: string, name: string) => {
        files.get(id)!.name = name
      },
      move: (id: string, parent: string) => {
        files.get(id)!.parents = [parent]
      },
      edit: (id: string, bytes: Uint8Array) => {
        files.get(id)!.bytes = Uint8Array.from(bytes)
      },
      trash: (id: string) => {
        files.get(id)!.trashed = true
      },
      remove: (id: string) => {
        const gone = (target: string): string[] => [
          target,
          ...[...files.values()].filter((file) => file.parents.includes(target)).flatMap((file) => gone(file.id)),
        ]
        gone(id).forEach((target) => files.delete(target))
      },
      upload: (name: string, parent: string, bytes: Uint8Array, appProperties: Record<string, string> = {}) =>
        store({ name, parents: [parent], appProperties }, bytes, false),
    },
    stop: () => server.stop(true),
  }
}

export type FakeDrive = ReturnType<typeof fakeDrive>
