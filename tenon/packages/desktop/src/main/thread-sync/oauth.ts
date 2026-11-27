import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { pkceChallenge, requestGoogleToken } from "../google-calendar-domain"

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
const CALLBACK = "/oauth2/callback"
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000

export type SignInInput = {
  clientId: string
  clientSecret: string
  scope: string
  endpoints: { authorize: string; token: string }
  openExternal(url: string): Promise<void>
  fetch: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
  now?: () => number
}

export async function googleSignIn(input: SignInInput) {
  const verifier = randomBytes(32).toString("base64url")
  const state = randomBytes(24).toString("base64url")
  const callback = Promise.withResolvers<string>()
  callback.promise.catch(() => undefined)
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    response.setHeader("Content-Type", "text/html; charset=utf-8")
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
    if (url.pathname !== CALLBACK) {
      response.writeHead(404).end("<p>Not found.</p>")
      return
    }
    if (url.searchParams.get("state") !== state) {
      response.writeHead(400).end("<p>Google sign-in could not be completed. You can close this window.</p>")
      return
    }
    const code = url.searchParams.get("code")
    if (url.searchParams.get("error") || !code) {
      response.writeHead(400).end("<p>Google sign-in could not be completed. You can close this window.</p>")
      callback.reject(new Error(url.searchParams.get("error") ? "google_oauth_denied" : "google_oauth_code_missing"))
      return
    }
    response.writeHead(200).end("<p>Tenon is signed in to Google Drive. You can close this window.</p>")
    callback.resolve(code)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("google_loopback_unavailable")
  }
  const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK}`
  const url = new URL(input.endpoints.authorize)
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("scope", input.scope)
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", pkceChallenge(verifier))
  url.searchParams.set("code_challenge_method", "S256")
  const cancelled = () => callback.reject(new Error("google_oauth_cancelled"))
  if (input.signal?.aborted) cancelled()
  input.signal?.addEventListener("abort", cancelled, { once: true })
  const timer = setTimeout(
    () => callback.reject(new Error("google_oauth_timeout")),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  try {
    await input.openExternal(url.href)
    const code = await callback.promise
    const tokens = await requestGoogleToken(input.fetch, input.endpoints.token, {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    })
    if (!tokens.access_token || !tokens.refresh_token) throw new Error("google_refresh_token_missing")
    const scope = tokens.scope ?? ""
    if (!scope.split(/\s+/).includes(input.scope)) throw new Error("google_scope_missing")
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: (input.now ?? Date.now)() + (tokens.expires_in ?? 0) * 1_000,
      scope,
    }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener("abort", cancelled)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
