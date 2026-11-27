import { createHash } from "node:crypto"
import { afterEach, describe, expect, test } from "bun:test"
import { fakeGoogle, memorySecrets, memoryStore, type FakeGoogle } from "./fake-google"
import { DRIVE_SCOPE, googleSignIn } from "./oauth"
import { decodePhrase, encodePhrase } from "./phrase"
import { createThreadSyncService } from "./service"

const clientId = "1234-test.apps.googleusercontent.com"
const clientSecret = "test-secret"
const corePhrase = "e926-bfe3-41d8-a9ca-50e2-c0ea-bb64-bdb6-d627-9df0-8d52-b01c-0c48-ded8-40d6-cfb1-243f-718a"
const coreKeyHex = "e926bfe341d8a9ca50e2c0eabb64bdb6d6279df08d52b01c0c48ded840d6cfb1"

const fakes: FakeGoogle[] = []
afterEach(async () => {
  await Promise.all(fakes.splice(0).map((fake) => fake.close()))
})

async function google(options: Parameters<typeof fakeGoogle>[0] = {}) {
  const fake = await fakeGoogle(options)
  fakes.push(fake)
  return fake
}

function endpoints(fake: FakeGoogle) {
  return { authorize: `${fake.url}/authorize`, token: `${fake.url}/token`, revoke: `${fake.url}/revoke` }
}

function signIn(fake: FakeGoogle, extra: Partial<Parameters<typeof googleSignIn>[0]> = {}) {
  return googleSignIn({
    clientId,
    clientSecret,
    scope: DRIVE_SCOPE,
    endpoints: endpoints(fake),
    openExternal: (url) => fake.openExternal(url),
    fetch,
    ...extra,
  })
}

function service(fake: FakeGoogle, input: { available?: boolean; now?: () => number } = {}) {
  const store = memoryStore()
  const sync = createThreadSyncService({
    secrets: memorySecrets(input.available ?? true),
    store,
    fetch,
    openExternal: (url) => fake.openExternal(url),
    endpoints: endpoints(fake),
    now: input.now,
  })
  return { sync, store }
}

describe("AC-P5b-1 installed-app sign-in", () => {
  test("opens the authorize URL with PKCE and exchanges the code", async () => {
    const fake = await google()
    const tokens = await signIn(fake)
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file")
    expect(tokens.accessToken).toStartWith("access-")
    expect(tokens.refreshToken).toStartWith("refresh-")
    expect(tokens.scope).toContain(DRIVE_SCOPE)
    const authorize = fake.authorizeRequests[0]!
    expect(authorize.searchParams.get("client_id")).toBe(clientId)
    expect(authorize.searchParams.get("response_type")).toBe("code")
    expect(authorize.searchParams.get("access_type")).toBe("offline")
    expect(authorize.searchParams.get("prompt")).toBe("consent")
    expect(authorize.searchParams.get("scope")).toBe(DRIVE_SCOPE)
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256")
    expect(authorize.searchParams.get("state")?.length).toBeGreaterThanOrEqual(16)
    const redirect = new URL(authorize.searchParams.get("redirect_uri")!)
    expect(redirect.hostname).toBe("127.0.0.1")
    expect(redirect.pathname).toBe("/oauth2/callback")
    const exchange = fake.tokenRequests[0]!
    expect(exchange.get("grant_type")).toBe("authorization_code")
    expect(exchange.get("client_secret")).toBe(clientSecret)
    expect(exchange.get("code_verifier")?.length).toBe(43)
    expect(createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url")).toBe(
      authorize.searchParams.get("code_challenge")!,
    )
    const closed = await fetch(redirect.href).then(
      () => "open",
      () => "closed",
    )
    expect(closed).toBe("closed")
  })

  test("a callback with another state is refused and the right one still lands", async () => {
    const fake = await google({ wrongStateFirst: true })
    const tokens = await signIn(fake)
    expect(tokens.refreshToken).toStartWith("refresh-")
  })

  test("each failure has its code", async () => {
    await expect(signIn(await google({ deny: true }))).rejects.toThrow("google_oauth_denied")
    await expect(signIn(await google({ noRefreshToken: true }))).rejects.toThrow("google_refresh_token_missing")
    await expect(signIn(await google({ scope: "openid email" }))).rejects.toThrow("google_scope_missing")
    const silent = await google()
    await expect(signIn(silent, { openExternal: async () => undefined, timeoutMs: 200 })).rejects.toThrow(
      "google_oauth_timeout",
    )
    const controller = new AbortController()
    const pending = signIn(silent, { signal: controller.signal, openExternal: async () => void controller.abort() })
    await expect(pending).rejects.toThrow("google_oauth_cancelled")
  })
})

describe("AC-P5b-2 credentials at rest", () => {
  test("only the client ID and sealed values are stored", async () => {
    const fake = await google()
    const { sync, store } = service(fake)
    await sync.setClient({ clientId, clientSecret })
    const signed = await sync.signIn()
    expect(signed.signedIn).toBe(true)
    const made = await sync.createKey()
    expect([...store.data.keys()].sort()).toEqual(["clientId", "clientSecret", "key", "refreshToken"])
    expect(store.data.get("clientId")).toBe(clientId)
    const dump = JSON.stringify([...store.data.entries()])
    const key = decodePhrase(made.phrase)
    for (const secret of [
      clientSecret,
      [...fake.refreshTokens][0]!,
      made.phrase,
      Buffer.from(key).toString("hex"),
      Buffer.from(key).toString("base64url"),
      Buffer.from(key).toString("base64"),
    ])
      expect(dump).not.toContain(secret)
  })

  test("without secure storage nothing can be saved", async () => {
    const fake = await google()
    const { sync, store } = service(fake, { available: false })
    expect((await sync.status()).secureStorage).toBe(false)
    await expect(sync.setClient({ clientId, clientSecret })).rejects.toThrow("secure_storage_unavailable")
    await expect(sync.signIn()).rejects.toThrow("secure_storage_unavailable")
    await expect(sync.createKey()).rejects.toThrow("secure_storage_unavailable")
    await expect(sync.enterPhrase(corePhrase)).rejects.toThrow("secure_storage_unavailable")
    expect(store.data.size).toBe(0)
  })

  test("sign-out revokes and deletes the refresh token and keeps the key", async () => {
    const fake = await google()
    const { sync, store } = service(fake)
    await sync.setClient({ clientId, clientSecret })
    await sync.signIn()
    await sync.createKey()
    const refresh = [...fake.refreshTokens][0]!
    const out = await sync.signOut()
    expect(out.signedIn).toBe(false)
    expect(out.key).toBe(true)
    expect(fake.revoked).toEqual([refresh])
    expect(store.data.has("refreshToken")).toBe(false)
    const forgot = await sync.forgetKey()
    expect(forgot.key).toBe(false)
    expect(store.data.has("key")).toBe(false)
    expect(store.data.get("clientId")).toBe(clientId)
  })
})

describe("AC-P5b-3 key and phrase", () => {
  test("the core engine's phrase format both ways", () => {
    expect(Buffer.from(decodePhrase(corePhrase)).toString("hex")).toBe(coreKeyHex)
    expect(Buffer.from(decodePhrase(`  ${corePhrase.toUpperCase()}\n`)).toString("hex")).toBe(coreKeyHex)
    expect(encodePhrase(Uint8Array.from(Buffer.from(coreKeyHex, "hex")))).toBe(corePhrase)
    for (const bad of ["", "not a phrase", corePhrase.slice(0, -1) + "b", corePhrase.replaceAll("-", "")])
      expect(() => decodePhrase(bad)).toThrow("invalid_phrase")
  })

  test("a key is made once and a phrase replaces it", async () => {
    const fake = await google()
    const { sync } = service(fake)
    const made = await sync.createKey()
    expect(made.phrase).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){17}$/)
    expect(made.status.key).toBe(true)
    await expect(sync.createKey()).rejects.toThrow("key_exists")
    await sync.enterPhrase(corePhrase)
    const answer = JSON.parse((await sync.bridge("sync_key")).text)
    expect(Buffer.from(answer.key, "base64url").toString("hex")).toBe(coreKeyHex)
    await expect(sync.enterPhrase("nope")).rejects.toThrow("invalid_phrase")
    expect(JSON.stringify(await sync.status())).not.toContain(coreKeyHex)
  })
})

describe("AC-P5b-4 bridge", () => {
  test("answers empty until there is something to answer", async () => {
    const fake = await google()
    const { sync } = service(fake)
    expect(await sync.bridge("sync_key")).toEqual({ text: "{}" })
    expect(await sync.bridge("sync_token")).toEqual({ text: "{}" })
  })

  test("caches the access token and refreshes it near expiry, keeping a rotated refresh token", async () => {
    const fake = await google({ rotate: true, expiresIn: 3600 })
    let now = 1_000_000
    const { sync } = service(fake, { now: () => now })
    await sync.setClient({ clientId, clientSecret })
    await sync.signIn()
    const first = JSON.parse((await sync.bridge("sync_token")).text).token
    expect(first).toStartWith("access-")
    expect(JSON.parse((await sync.bridge("sync_token")).text).token).toBe(first)
    now += 3600_000 - 30_000
    const second = JSON.parse((await sync.bridge("sync_token")).text).token
    expect(second).not.toBe(first)
    expect(fake.tokenRequests.at(-1)?.get("grant_type")).toBe("refresh_token")
    now += 3600_000
    const third = JSON.parse((await sync.bridge("sync_token")).text).token
    expect(third).not.toBe(second)
  })

  test("a refused refresh signs out", async () => {
    const fake = await google({ expiresIn: 1 })
    const { sync, store } = service(fake)
    await sync.setClient({ clientId, clientSecret })
    await sync.signIn()
    fake.refreshTokens.clear()
    expect(await sync.bridge("sync_token")).toEqual({ text: "{}" })
    expect(store.data.has("refreshToken")).toBe(false)
    expect((await sync.status()).signedIn).toBe(false)
  })
})
