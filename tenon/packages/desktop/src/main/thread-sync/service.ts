import { randomBytes } from "node:crypto"
import type { ThreadSyncDesktopStatus } from "@tenon/app"
import { requestGoogleToken, validateGoogleClient } from "../google-calendar-domain"
import { DRIVE_SCOPE, googleSignIn } from "./oauth"
import { decodePhrase, encodePhrase } from "./phrase"

export const GOOGLE_ENDPOINTS = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
}

const REFRESH_MARGIN_MS = 60_000

type Secrets = {
  available(): Promise<boolean>
  encrypt(value: string): Promise<string>
  decrypt(value: string): Promise<string>
}

type KeyValue = {
  get(key: string): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
}

export type ThreadSyncServiceInput = {
  secrets: Secrets
  store: KeyValue
  fetch: typeof fetch
  openExternal(url: string): Promise<void>
  endpoints?: { authorize: string; token: string; revoke: string }
  now?: () => number
}

export type ThreadSyncService = ReturnType<typeof createThreadSyncService>

export function createThreadSyncService(input: ThreadSyncServiceInput) {
  const endpoints = input.endpoints ?? GOOGLE_ENDPOINTS
  const now = input.now ?? Date.now
  const state = {
    signIn: undefined as AbortController | undefined,
    error: null as string | null,
    access: undefined as { token: string; expiresAt: number } | undefined,
    refreshing: undefined as Promise<string | undefined> | undefined,
  }

  const text = (key: string) => {
    const value = input.store.get(key)
    return typeof value === "string" && value ? value : undefined
  }
  const reveal = (key: string) => {
    const sealed = text(key)
    if (!sealed) return Promise.resolve(undefined)
    return input.secrets.decrypt(sealed).catch(() => undefined)
  }
  const seal = async (key: string, value: string) => input.store.set(key, await input.secrets.encrypt(value))
  const requireSecureStorage = async () => {
    if (!(await input.secrets.available())) throw new Error("secure_storage_unavailable")
  }
  const storedKey = async () => {
    const value = await reveal("key")
    if (!value) return undefined
    const bytes = Buffer.from(value, "base64url")
    return bytes.length === 32 ? Uint8Array.from(bytes) : undefined
  }

  const status = async (): Promise<ThreadSyncDesktopStatus> => ({
    secureStorage: await input.secrets.available(),
    clientId: text("clientId") ?? null,
    signedIn: Boolean(await reveal("refreshToken")),
    signingIn: Boolean(state.signIn),
    key: Boolean(await storedKey()),
    error: state.error,
  })

  const forgetToken = () => {
    input.store.delete("refreshToken")
    state.access = undefined
  }

  const revoke = async () => {
    const refreshToken = await reveal("refreshToken")
    forgetToken()
    if (!refreshToken) return
    await input
      .fetch(endpoints.revoke, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
        signal: AbortSignal.timeout(15_000),
      })
      .catch(() => undefined)
  }

  const client = async () => {
    const clientId = text("clientId")
    const clientSecret = await reveal("clientSecret")
    if (!clientId || !clientSecret) return undefined
    return { clientId, clientSecret }
  }

  const refresh = async () => {
    const refreshToken = await reveal("refreshToken")
    const credentials = await client()
    if (!refreshToken || !credentials) return undefined
    const tokens = await requestGoogleToken(input.fetch, endpoints.token, {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).catch((error: unknown) => {
      const code = error instanceof Error && error.message.startsWith("google_") ? error.message : "google_unavailable"
      state.error = code
      if (code === "google_reconnect_required") forgetToken()
      return undefined
    })
    if (!tokens?.access_token) return undefined
    if (tokens.refresh_token) await seal("refreshToken", tokens.refresh_token)
    state.access = { token: tokens.access_token, expiresAt: now() + (tokens.expires_in ?? 0) * 1_000 }
    state.error = null
    return tokens.access_token
  }

  const accessToken = async () => {
    const cached = state.access
    if (cached && cached.expiresAt - now() > REFRESH_MARGIN_MS) return cached.token
    if (state.refreshing) return state.refreshing
    const pending = refresh().finally(() => {
      state.refreshing = undefined
    })
    state.refreshing = pending
    return pending
  }

  return {
    status,

    async setClient(change: { clientId: string; clientSecret: string }) {
      await requireSecureStorage()
      const next = validateGoogleClient(change.clientId, change.clientSecret)
      const previous = await client()
      if (previous && (previous.clientId !== next.clientId || previous.clientSecret !== next.clientSecret))
        await revoke()
      input.store.set("clientId", next.clientId)
      await seal("clientSecret", next.clientSecret)
      return status()
    },

    async signIn() {
      if (state.signIn) throw new Error("google_operation_busy")
      await requireSecureStorage()
      const credentials = await client()
      if (!credentials) throw new Error("google_client_missing")
      const controller = new AbortController()
      state.signIn = controller
      state.error = null
      try {
        const tokens = await googleSignIn({
          ...credentials,
          scope: DRIVE_SCOPE,
          endpoints,
          openExternal: input.openExternal,
          fetch: input.fetch,
          signal: controller.signal,
          now,
        })
        await seal("refreshToken", tokens.refreshToken)
        state.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
        return status()
      } catch (error) {
        state.error = error instanceof Error ? error.message : "google_sign_in_failed"
        throw error
      } finally {
        state.signIn = undefined
      }
    },

    cancelSignIn() {
      state.signIn?.abort()
    },

    async signOut() {
      await revoke()
      state.error = null
      return status()
    },

    async createKey() {
      await requireSecureStorage()
      if (await storedKey()) throw new Error("key_exists")
      const key = Uint8Array.from(randomBytes(32))
      await seal("key", Buffer.from(key).toString("base64url"))
      return { phrase: encodePhrase(key), status: await status() }
    },

    async enterPhrase(phrase: string) {
      await requireSecureStorage()
      const key = decodePhrase(phrase)
      await seal("key", Buffer.from(key).toString("base64url"))
      return status()
    },

    async forgetKey() {
      input.store.delete("key")
      return status()
    },

    async bridge(route: "sync_key" | "sync_token") {
      if (route === "sync_key") {
        const key = await storedKey()
        return { text: key ? JSON.stringify({ key: Buffer.from(key).toString("base64url") }) : "{}" }
      }
      const token = await accessToken()
      return { text: token ? JSON.stringify({ token }) : "{}" }
    },
  }
}
