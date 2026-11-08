import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import type { MailAccount, MailPlatform } from "@tenon/app"
import { net, safeStorage, shell } from "electron"
import {
  builtInGoogleClient,
  createGoogleAccessTokens,
  pkceChallenge,
  requestGoogleToken,
} from "../google-calendar-domain"
import { write as writeLog } from "../logging"
import { decryptSecret, encryptSecret } from "../secret-storage"
import { getStore } from "../store"
import { createImapClient, verifyImap } from "./imap-client"
import {
  createGmailProvider,
  createGraphProvider,
  createImapProvider,
  GMAIL_SCOPES,
  GRAPH_SCOPES,
  saveImapPassword,
  type MailProvider,
} from "./index"

/**
 * Mail accounts for the Command Centre (Settings › Accounts) and the loopback endpoint the server's mail
 * tools call. Gmail signs in with the app's Google OAuth client (as Calendar does) asking only for
 * gmail.readonly and gmail.compose; Outlook signs in through Microsoft identity with PKCE on a loopback
 * redirect; IMAP stores an app password. Refresh tokens and passwords are encrypted with safeStorage
 * (Keychain on macOS, DPAPI on Windows). Nothing here sends email.
 */

const storeName = "tenon.mail"
const googleAuthorize = "https://accounts.google.com/o/oauth2/v2/auth"
const googleToken = "https://oauth2.googleapis.com/token"
const microsoftAuthorize = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
const microsoftToken = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
const oauthTimeoutMs = 5 * 60 * 1_000
const bodyLimit = 256 * 1024
const bodyTooLarge = "mail_body_too_large"

const googleClient = builtInGoogleClient({
  clientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
  clientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
})
// A public (no secret) Microsoft identity client registered for http://localhost redirects.
const microsoftClientId = import.meta.env.MAIN_VITE_MICROSOFT_CLIENT_ID?.trim() || undefined

type StoredAccount = {
  id: string
  provider: MailAccount["provider"]
  address: string
  /** Encrypted refresh token (Gmail, Outlook). */
  refreshToken?: string
  imap?: { host: string; port: number; secure: boolean; user: string }
}

const netFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  net.fetch(String(input instanceof Request ? input.url : input), init)) as typeof globalThis.fetch

export type MailService = MailPlatform & {
  provider(account?: string): Promise<MailProvider>
}

export function createMailService(): MailService {
  const googleTokens = createGoogleAccessTokens({
    fetch: (input, init) => net.fetch(input, init),
    endpoint: googleToken,
    onRotate: async (accountId, refreshToken) => update(accountId, { refreshToken: await encrypt(refreshToken) }),
  })
  const graphTokens = new Map<string, { token: string; expiresAt: number }>()
  let consent: AbortController | undefined

  const graphToken = async (account: StoredAccount) => {
    const cached = graphTokens.get(account.id)
    if (cached && cached.expiresAt > Date.now()) return cached.token
    if (!microsoftClientId || !account.refreshToken) throw new Error("mail_reconnect_required")
    const tokens = await tokenRequest(microsoftToken, {
      client_id: microsoftClientId,
      grant_type: "refresh_token",
      refresh_token: await decrypt(account.refreshToken, (fresh) => replaceRefreshToken(account, fresh)),
      scope: GRAPH_SCOPES.join(" "),
    })
    if (tokens.refresh_token) update(account.id, { refreshToken: await encrypt(tokens.refresh_token) })
    graphTokens.set(account.id, {
      token: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in - 60) * 1_000,
    })
    return tokens.access_token
  }

  const provider = async (selector?: string): Promise<MailProvider> => {
    const accounts = read()
    const account = selector
      ? accounts.find((item) => item.id === selector || item.address.toLowerCase() === selector.toLowerCase())
      : accounts[0]
    if (!account) throw new Error(selector ? "mail_account_not_found" : "mail_no_account")
    if (account.provider === "gmail") {
      if (!googleClient || !account.refreshToken) throw new Error("mail_reconnect_required")
      const credentials = {
        accountId: account.id,
        ...googleClient,
        refreshToken: await decrypt(account.refreshToken, (fresh) => replaceRefreshToken(account, fresh)),
      }
      return createGmailProvider({ fetch: netFetch, accessToken: () => googleTokens.get(credentials) })
    }
    if (account.provider === "outlook")
      return createGraphProvider({ fetch: netFetch, accessToken: () => graphToken(account) })
    const password = getStore(storeName).get(`imap-password:${account.id}`)
    if (!account.imap || typeof password !== "string") throw new Error("mail_reconnect_required")
    return createImapProvider({
      client: createImapClient({
        ...account.imap,
        password: await decrypt(password, (fresh) => replaceImapPassword(account.id, password, fresh)),
      }),
    })
  }

  const connect: MailPlatform["connect"] = async (kind) => {
    if (!(await secure())) throw new Error("mail_secure_storage_unavailable")
    consent?.abort()
    const controller = new AbortController()
    consent = controller
    if (kind === "gmail") {
      if (!googleClient) throw new Error("mail_gmail_unavailable")
      const tokens = await authorize({
        endpoint: googleAuthorize,
        tokenEndpoint: googleToken,
        clientId: googleClient.clientId,
        clientSecret: googleClient.clientSecret,
        scopes: [...GMAIL_SCOPES],
        extra: { access_type: "offline", prompt: "select_account consent" },
        signal: controller.signal,
      })
      const profile = (await (
        await netFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
      ).json()) as { emailAddress?: string }
      save({
        id: randomUUID(),
        provider: "gmail",
        address: profile.emailAddress ?? "Gmail",
        refreshToken: await encrypt(tokens.refresh_token),
      })
      return accounts()
    }
    if (!microsoftClientId) throw new Error("mail_outlook_unavailable")
    const tokens = await authorize({
      endpoint: microsoftAuthorize,
      tokenEndpoint: microsoftToken,
      clientId: microsoftClientId,
      scopes: [...GRAPH_SCOPES],
      extra: { prompt: "select_account" },
      host: "localhost",
      signal: controller.signal,
    })
    save({
      id: randomUUID(),
      provider: "outlook",
      address: tokenAddress(tokens.access_token) ?? "Outlook",
      refreshToken: await encrypt(tokens.refresh_token),
    })
    return accounts()
  }

  const addImap: MailPlatform["addImap"] = async (input) => {
    // Same keychain check as connect(): Linux's basic_text backend would store the password readable.
    if (!(await secure())) throw new Error("mail_secure_storage_unavailable")
    const host = input.host.trim()
    const user = input.user.trim()
    const port = Number(input.port)
    if (!host || !user || !input.password || !Number.isInteger(port) || port <= 0 || port > 65_535)
      throw new Error("mail_imap_invalid")
    const id = randomUUID()
    // Check the login before keeping anything.
    await verifyImap({ host, port, secure: input.secure, user, password: input.password })
    await saveImapPassword(
      { safeStorage, write: (key, value) => getStore(storeName).set(key, value) },
      id,
      input.password,
    )
    save({
      id,
      provider: "imap",
      address: input.address?.trim() || user,
      imap: { host, port, secure: input.secure, user },
    })
    return accounts()
  }

  const remove: MailPlatform["remove"] = async (id) => {
    const store = getStore(storeName)
    store.set(
      "accounts",
      read().filter((account) => account.id !== id),
    )
    store.delete(`imap-password:${id}`)
    graphTokens.delete(id)
    googleTokens.clear(id)
    return accounts()
  }

  const accounts = async (): Promise<MailAccount[]> =>
    read().map((account) => ({ id: account.id, provider: account.provider, address: account.address }))

  return {
    available: async () => ({
      secureStorage: await secure(),
      gmail: Boolean(googleClient),
      outlook: Boolean(microsoftClientId),
      imap: true,
    }),
    accounts,
    connect,
    addImap,
    remove,
    provider,
  }
}

/**
 * The loopback endpoint the server's mail tools call: `POST /search`, `/thread`, `/draft` with
 * `Authorization: Bearer <token>`. Only the server process gets the token (TENON_MAIL_TOKEN); a request
 * with an Origin header (a web page) is refused. There is no send route.
 */
export function startMailEndpoint(service: MailService) {
  const token = randomBytes(32).toString("base64url")
  const expected = Buffer.from(`Bearer ${token}`)
  return new Promise<{ url: string; token: string }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const answer = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" })
        response.end(JSON.stringify(body))
      }
      const given = Buffer.from(request.headers.authorization ?? "")
      if (
        request.method !== "POST" ||
        request.headers.origin ||
        given.length !== expected.length ||
        !timingSafeEqual(given, expected)
      )
        return answer(403, { error: "Forbidden" })
      void readJSON(request)
        .then((input) => route((request.url ?? "").split("?")[0] ?? "", input, service))
        .then(
          (result) => answer(200, result),
          (cause: unknown) => {
            const message = cause instanceof Error ? cause.message : String(cause)
            writeLog("mail", "mail request failed", { route: request.url, message }, "warn")
            if (message !== bodyTooLarge) return answer(200, { error: message })
            // The rest of the body is never read; close the connection after answering.
            response.setHeader("connection", "close")
            answer(413, { error: message })
          },
        )
    })
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("The mail endpoint has no port."))
      server.unref()
      resolve({ url: `http://127.0.0.1:${address.port}`, token })
    })
  })
}

async function route(path: string, input: Record<string, unknown>, service: MailService) {
  const account = typeof input.account === "string" && input.account.trim() ? input.account.trim() : undefined
  const text = (key: string) => {
    const value = input[key]
    if (typeof value !== "string" || !value.trim()) throw new Error(`mail_${key}_required`)
    return value
  }
  if (path === "/search") return { results: await (await service.provider(account)).search(text("query")) }
  if (path === "/thread") return await (await service.provider(account)).readThread(text("id"))
  if (path === "/draft") {
    const draft = await (
      await service.provider(account)
    ).createDraft({
      to: text("to"),
      subject: typeof input.subject === "string" ? input.subject : "",
      body: typeof input.body === "string" ? input.body : "",
      ...(typeof input.replyTo === "string" && input.replyTo ? { replyTo: input.replyTo } : {}),
    })
    return { id: draft.id, saved: "draft" }
  }
  throw new Error("mail_unknown_route")
}

function readJSON(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = ""
    let tooLarge = false
    request.on("data", (chunk: Buffer) => {
      if (tooLarge) return
      body += chunk.toString()
      if (body.length <= bodyLimit) return
      tooLarge = true
      body = ""
      reject(new Error(bodyTooLarge))
    })
    request.on("end", () => {
      if (tooLarge) return
      try {
        const value: unknown = JSON.parse(body || "{}")
        resolve(value && typeof value === "object" ? (value as Record<string, unknown>) : {})
      } catch (cause) {
        reject(cause)
      }
    })
    request.on("error", reject)
  })
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number }

async function tokenRequest(endpoint: string, body: Record<string, string>) {
  const response = await net.fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30_000),
  })
  const value = (await response.json().catch(() => ({}))) as Partial<Tokens> & { error?: string }
  if (!response.ok || value.error || !value.access_token) throw new Error("mail_token_exchange_failed")
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token ?? "",
    expires_in: value.expires_in ?? 3600,
  }
}

/** OAuth authorization code with PKCE on a one-shot loopback redirect, in the user's browser. */
async function authorize(input: {
  endpoint: string
  tokenEndpoint: string
  clientId: string
  clientSecret?: string
  scopes: string[]
  extra: Record<string, string>
  /** Microsoft only matches `localhost` (any port) for desktop redirects. */
  host?: "127.0.0.1" | "localhost"
  signal: AbortSignal
}) {
  const verifier = randomBytes(32).toString("base64url")
  const state = randomBytes(24).toString("base64url")
  const callback = Promise.withResolvers<string>()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    response.setHeader("Content-Type", "text/html; charset=utf-8")
    response.setHeader("Content-Security-Policy", "default-src 'none'")
    // Any local process can hit this port; a request without our state is refused but does not end sign-in.
    if (url.pathname !== "/" || url.searchParams.get("state") !== state) {
      response.writeHead(400).end("<p>Sign-in could not be completed. You can close this window.</p>")
      return
    }
    const code = url.searchParams.get("code")
    if (!code) {
      response.writeHead(400).end("<p>Sign-in could not be completed. You can close this window.</p>")
      callback.reject(new Error(url.searchParams.get("error") ? "mail_oauth_denied" : "mail_oauth_code_missing"))
      return
    }
    response.writeHead(200).end("<p>Your mail account is connected. You can close this window.</p>")
    callback.resolve(code)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("mail_loopback_unavailable")
  }
  const redirectUri = `http://${input.host ?? "127.0.0.1"}:${address.port}/`
  const url = new URL(input.endpoint)
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", input.scopes.join(" "))
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", pkceChallenge(verifier))
  url.searchParams.set("code_challenge_method", "S256")
  for (const [key, value] of Object.entries(input.extra)) url.searchParams.set(key, value)
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancelled = () => callback.reject(new Error("mail_oauth_cancelled"))
  input.signal.addEventListener("abort", cancelled, { once: true })
  try {
    await shell.openExternal(url.href)
    const code = await Promise.race([
      callback.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("mail_oauth_timeout")), oauthTimeoutMs)
      }),
    ])
    const body = {
      client_id: input.clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
    }
    const tokens = input.clientSecret
      ? await requestGoogleToken((target, init) => net.fetch(target, init), input.tokenEndpoint, body)
      : await tokenRequest(input.tokenEndpoint, body)
    if (!tokens.access_token || !tokens.refresh_token) throw new Error("mail_refresh_token_missing")
    return { access_token: tokens.access_token, refresh_token: tokens.refresh_token }
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener("abort", cancelled)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** The signed-in address from a Microsoft access token's claims, when the token is a readable JWT. */
function tokenAddress(token: string) {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<
      string,
      unknown
    >
    const value = claims.upn ?? claims.preferred_username ?? claims.unique_name ?? claims.email
    return typeof value === "string" ? value : undefined
  } catch {
    return undefined
  }
}

async function secure() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"
}

function read(): StoredAccount[] {
  const value = getStore(storeName).get("accounts")
  return Array.isArray(value)
    ? value.filter(
        (item): item is StoredAccount =>
          !!item &&
          typeof item === "object" &&
          typeof (item as StoredAccount).id === "string" &&
          ["gmail", "outlook", "imap"].includes((item as StoredAccount).provider),
      )
    : []
}

function save(account: StoredAccount) {
  // Signing in to the same address again replaces that account.
  const others = read().filter(
    (item) => !(item.provider === account.provider && item.address.toLowerCase() === account.address.toLowerCase()),
  )
  getStore(storeName).set("accounts", [...others, account])
}

function update(id: string, patch: Partial<StoredAccount>) {
  getStore(storeName).set(
    "accounts",
    read().map((account) => (account.id === id ? { ...account, ...patch } : account)),
  )
}

/** Stores a re-encrypted secret unless the account signed in again in the meantime. */
function replaceRefreshToken(account: StoredAccount, fresh: string) {
  if (!read().some((item) => item.id === account.id && item.refreshToken === account.refreshToken)) return
  update(account.id, { refreshToken: fresh })
}

function replaceImapPassword(accountId: string, previous: string, fresh: string) {
  const store = getStore(storeName)
  if (store.get(`imap-password:${accountId}`) === previous) store.set(`imap-password:${accountId}`, fresh)
}

function encrypt(value: string) {
  return encryptSecret(safeStorage, value)
}

function decrypt(value: string, onReEncrypt?: (encrypted: string) => void) {
  return decryptSecret(safeStorage, value, onReEncrypt)
}
