import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"

export type FakeGoogleOptions = {
  deny?: boolean
  noRefreshToken?: boolean
  scope?: string
  wrongStateFirst?: boolean
  expiresIn?: number
  rotate?: boolean
  accessToken?: string
}

export type FakeGoogle = {
  url: string
  authorizeRequests: URL[]
  tokenRequests: URLSearchParams[]
  revoked: string[]
  options: FakeGoogleOptions
  refreshTokens: Set<string>
  openExternal(url: string): Promise<void>
  close(): Promise<void>
}

export async function fakeGoogle(options: FakeGoogleOptions = {}): Promise<FakeGoogle> {
  const codes = new Map<string, { challenge: string; redirect: string; clientId: string }>()
  const authorizeRequests: URL[] = []
  const tokenRequests: URLSearchParams[] = []
  const revoked: string[] = []
  const refreshTokens = new Set<string>()
  let issued = 0
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method === "GET" && url.pathname === "/authorize") {
      authorizeRequests.push(url)
      const redirect = url.searchParams.get("redirect_uri") ?? ""
      const state = url.searchParams.get("state") ?? ""
      const target = new URL(redirect)
      if (options.deny) {
        target.searchParams.set("error", "access_denied")
        target.searchParams.set("state", state)
        response.writeHead(302, { location: target.href }).end()
        return
      }
      const code = `code-${++issued}`
      codes.set(code, {
        challenge: url.searchParams.get("code_challenge") ?? "",
        redirect,
        clientId: url.searchParams.get("client_id") ?? "",
      })
      target.searchParams.set("code", code)
      target.searchParams.set("state", state)
      response.writeHead(302, { location: target.href }).end()
      return
    }
    if (request.method === "POST" && (url.pathname === "/token" || url.pathname === "/revoke")) {
      let body = ""
      request.on("data", (chunk: Buffer) => (body += chunk.toString()))
      request.on("end", () => {
        const form = new URLSearchParams(body)
        if (url.pathname === "/revoke") {
          revoked.push(form.get("token") ?? "")
          response.writeHead(200).end()
          return
        }
        tokenRequests.push(form)
        const json = (status: number, value: unknown) => {
          response.writeHead(status, { "content-type": "application/json" })
          response.end(JSON.stringify(value))
        }
        const scope = options.scope ?? "https://www.googleapis.com/auth/drive.file"
        if (form.get("grant_type") === "authorization_code") {
          const entry = codes.get(form.get("code") ?? "")
          const verifier = form.get("code_verifier") ?? ""
          const challenge = createHash("sha256").update(verifier).digest("base64url")
          if (
            !entry ||
            entry.challenge !== challenge ||
            entry.redirect !== form.get("redirect_uri") ||
            entry.clientId !== form.get("client_id")
          )
            return json(400, { error: "invalid_grant" })
          codes.delete(form.get("code") ?? "")
          const refresh = `refresh-${++issued}`
          if (!options.noRefreshToken) refreshTokens.add(refresh)
          return json(200, {
            access_token: options.accessToken ?? `access-${issued}`,
            expires_in: options.expiresIn ?? 3600,
            scope,
            token_type: "Bearer",
            ...(options.noRefreshToken ? {} : { refresh_token: refresh }),
          })
        }
        if (form.get("grant_type") === "refresh_token") {
          const refresh = form.get("refresh_token") ?? ""
          if (!refreshTokens.has(refresh)) return json(400, { error: "invalid_grant" })
          const next = `refresh-${++issued}`
          if (options.rotate) {
            refreshTokens.delete(refresh)
            refreshTokens.add(next)
          }
          return json(200, {
            access_token: options.accessToken ?? `access-${issued}`,
            expires_in: options.expiresIn ?? 3600,
            scope,
            token_type: "Bearer",
            ...(options.rotate ? { refresh_token: next } : {}),
          })
        }
        json(400, { error: "unsupported_grant_type" })
      })
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fake google has no port")
  const url = `http://127.0.0.1:${address.port}`
  return {
    url,
    authorizeRequests,
    tokenRequests,
    revoked,
    options,
    refreshTokens,
    async openExternal(target: string) {
      const authorize = await fetch(target, { redirect: "manual" })
      const location = authorize.headers.get("location")
      if (!location) return
      if (options.wrongStateFirst) {
        const wrong = new URL(location)
        wrong.searchParams.set("state", "not-the-state")
        const refused = await fetch(wrong.href)
        if (refused.status !== 400) throw new Error(`wrong state answered ${refused.status}`)
      }
      void fetch(location).catch(() => undefined)
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

export function memorySecrets(available = true) {
  return {
    available: async () => available,
    encrypt: async (value: string) => `sealed:${Buffer.from(value).reverse().toString("base64")}`,
    decrypt: async (value: string) => {
      if (!value.startsWith("sealed:")) throw new Error("not sealed")
      return Buffer.from(value.slice("sealed:".length), "base64").reverse().toString()
    },
  }
}

export function memoryStore() {
  const data = new Map<string, unknown>()
  return {
    data,
    get: (key: string) => data.get(key),
    set: (key: string, value: unknown) => void data.set(key, value),
    delete: (key: string) => void data.delete(key),
  }
}
