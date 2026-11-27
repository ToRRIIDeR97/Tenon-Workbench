import {
  createServer,
  request as forwardRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"

export type RemoteListener = { url: string; stop(): Promise<void> }

export const PHONE_ORIGINS = ["capacitor://localhost", "https://localhost", "http://localhost"]

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
])

export async function startRemoteListener(input: { host: string; port: number; target: () => string }) {
  const server = createServer((request, response) => handle(request, response, input.target()))
  server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(input.port, input.host, () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  const port = address && typeof address === "object" ? address.port : input.port
  const host = input.host.includes(":") ? `[${input.host}]` : input.host
  return {
    url: `http://${host}:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  } satisfies RemoteListener
}

function handle(request: IncomingMessage, response: ServerResponse, target: string) {
  if (request.headers.upgrade) {
    response.writeHead(403, { connection: "close" }).end()
    return
  }
  const origin = PHONE_ORIGINS.includes(request.headers.origin ?? "") ? request.headers.origin : undefined
  if (origin) cors(response, origin, request.headers)
  if (request.method === "OPTIONS" && request.headers["access-control-request-method"]) {
    response.writeHead(origin ? 204 : 403).end()
    return
  }
  if (!admitted(request)) {
    response.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" })
    response.end(JSON.stringify({ error: "unauthorized" }))
    return
  }
  const destination = new URL(target)
  const upstream = forwardRequest(
    {
      protocol: destination.protocol,
      hostname: destination.hostname,
      port: destination.port,
      method: request.method,
      path: request.url,
      headers: {
        ...Object.fromEntries(
          Object.entries(forwardable(request.headers)).filter(([name]) => !(origin && name === "origin")),
        ),
        host: destination.host,
      },
    },
    (answer) => {
      const headers = Object.fromEntries(
        Object.entries(forwardable(answer.headers)).filter(([name]) => !name.startsWith("access-control-")),
      )
      response.writeHead(answer.statusCode ?? 502, headers)
      response.flushHeaders()
      answer.pipe(response)
    },
  )
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "server_unavailable" }))
      return
    }
    response.destroy()
  })
  response.on("close", () => {
    if (!response.writableFinished) upstream.destroy()
  })
  request.pipe(upstream)
}

function admitted(request: IncomingMessage) {
  const url = new URL(request.url ?? "/", "http://remote")
  if (url.searchParams.has("auth_token")) return false
  const authorization = request.headers.authorization
  if (authorization !== undefined) return /^bearer\s+\S+$/i.test(authorization.trim())
  if (request.method === "POST" && url.pathname === "/remote/pair") return true
  return request.method === "GET" && url.searchParams.has("ticket")
}

function forwardable(headers: IncomingHttpHeaders) {
  const named = (headers.connection ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) => value !== undefined && !HOP_BY_HOP.has(name) && !named.includes(name),
    ),
  )
}

function cors(response: ServerResponse, origin: string, headers: IncomingHttpHeaders) {
  response.setHeader("access-control-allow-origin", origin)
  response.setHeader("vary", "origin")
  response.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
  response.setHeader(
    "access-control-allow-headers",
    headers["access-control-request-headers"] ?? "authorization, content-type, x-opencode-directory",
  )
  response.setHeader("access-control-max-age", "600")
}
