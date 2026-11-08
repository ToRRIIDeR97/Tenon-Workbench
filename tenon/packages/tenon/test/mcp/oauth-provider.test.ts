import { test, expect, describe } from "bun:test"
import { auth, determineScope } from "@modelcontextprotocol/sdk/client/auth.js"
import { Effect } from "effect"
import {
  McpOAuthPendingProvider,
  McpOAuthProvider,
  OAUTH_CALLBACK_PORT,
  OAUTH_CALLBACK_PATH,
} from "../../src/mcp/oauth-provider"
import type { McpAuth } from "../../src/mcp/auth"

// Stub auth — only synchronous getters are exercised in these tests
const stubAuth = {} as McpAuth.Interface

const makeProvider = (config: ConstructorParameters<typeof McpOAuthProvider>[2]) =>
  new McpOAuthProvider("test-server", "https://mcp.example.com/mcp", config, { onRedirect: async () => {} }, stubAuth)

describe("McpOAuthProvider.redirectUrl", () => {
  test("defaults to 127.0.0.1:19876/mcp/oauth/callback", () => {
    const provider = makeProvider({})
    expect(provider.redirectUrl).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`)
  })

  test("uses callbackPort when set", () => {
    const provider = makeProvider({ callbackPort: 6620 })
    expect(provider.redirectUrl).toBe(`http://127.0.0.1:6620${OAUTH_CALLBACK_PATH}`)
  })

  test("redirectUri takes precedence over callbackPort", () => {
    const provider = makeProvider({
      callbackPort: 6620,
      redirectUri: "http://127.0.0.1:9999/custom/callback",
    })
    expect(provider.redirectUrl).toBe("http://127.0.0.1:9999/custom/callback")
  })

  test("uses explicit redirectUri when set without callbackPort", () => {
    const provider = makeProvider({ redirectUri: "http://127.0.0.1:8080/oauth/callback" })
    expect(provider.redirectUrl).toBe("http://127.0.0.1:8080/oauth/callback")
  })
})

describe("McpOAuthProvider.clientMetadata", () => {
  test("includes redirect_uris from redirectUrl", () => {
    const provider = makeProvider({ callbackPort: 6620 })
    expect(provider.clientMetadata.redirect_uris).toEqual([`http://127.0.0.1:6620${OAUTH_CALLBACK_PATH}`])
  })

  test("includes scope when set in config", () => {
    const provider = makeProvider({ scope: "openid offline_access" })
    expect(provider.clientMetadata.scope).toBe("openid offline_access")
  })

  test("omits scope when not set in config", () => {
    const provider = makeProvider({})
    expect(provider.clientMetadata.scope).toBeUndefined()
  })

  test("sets token_endpoint_auth_method to client_secret_post when clientSecret provided", () => {
    const provider = makeProvider({ clientSecret: "secret" })
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("client_secret_post")
  })

  test("sets token_endpoint_auth_method to none when no clientSecret", () => {
    const provider = makeProvider({})
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none")
  })
})

describe("MCP OAuth scope selection", () => {
  test("adds offline_access when the authorization server and client support refresh tokens", () => {
    expect(
      determineScope({
        resourceMetadata: {
          resource: "https://mcp.example.com/mcp",
          scopes_supported: ["resource.read"],
        },
        authServerMetadata: {
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          response_types_supported: ["code"],
          scopes_supported: ["resource.read", "offline_access"],
        },
        clientMetadata: makeProvider({}).clientMetadata,
      }),
    ).toBe("resource.read offline_access")
  })

  test("does not add unsupported authorization server scopes", () => {
    expect(
      determineScope({
        resourceMetadata: {
          resource: "https://mcp.example.com/mcp",
          scopes_supported: ["resource.read"],
        },
        authServerMetadata: {
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          response_types_supported: ["code"],
          scopes_supported: ["resource.read"],
        },
        clientMetadata: makeProvider({}).clientMetadata,
      }),
    ).toBe("resource.read")
  })
})

// In-memory stand-in for the mcp-auth.json store
function memoryAuth() {
  const data: Record<string, McpAuth.Entry> = {}
  const update = (name: string, patch: Partial<McpAuth.Entry>, serverUrl?: string) =>
    Effect.sync(() => {
      data[name] = { ...data[name], ...patch, ...(serverUrl ? { serverUrl } : {}) }
    })
  const store = {
    get: (name: string) => Effect.succeed(data[name]),
    getForUrl: (name: string, url: string) => Effect.succeed(data[name]?.serverUrl === url ? data[name] : undefined),
    set: (name: string, entry: McpAuth.Entry, serverUrl?: string) =>
      Effect.sync(() => {
        data[name] = serverUrl ? { ...entry, serverUrl } : entry
      }),
    remove: (name: string) => Effect.sync(() => void delete data[name]),
    updateTokens: (name: string, tokens: McpAuth.Tokens, serverUrl?: string) => update(name, { tokens }, serverUrl),
    updateClientInfo: (name: string, clientInfo: McpAuth.ClientInfo, serverUrl?: string) =>
      update(name, { clientInfo }, serverUrl),
    updateCodeVerifier: (name: string, codeVerifier: string) => update(name, { codeVerifier }),
    updateOAuthState: (name: string, oauthState: string) => update(name, { oauthState }),
    all: () => Effect.succeed(data),
    clearCodeVerifier: (name: string) => update(name, { codeVerifier: undefined }),
    getOAuthState: (name: string) => Effect.succeed(data[name]?.oauthState),
    clearOAuthState: (name: string) => update(name, { oauthState: undefined }),
  } satisfies McpAuth.Interface
  return { data, store }
}

const serverUrl = "https://mcp.example.com/mcp"

describe("McpOAuthProvider issuer binding", () => {
  test("stores the issuer the SDK stamps on tokens and registered clients", async () => {
    const { data, store } = memoryAuth()
    const provider = new McpOAuthProvider("test-server", serverUrl, {}, { onRedirect: async () => {} }, store)
    await provider.saveClientInformation({ client_id: "dyn", redirect_uris: [], issuer: "https://as.example.com/" })
    await provider.saveTokens({
      access_token: "a",
      token_type: "Bearer",
      refresh_token: "r",
      issuer: "https://as.example.com/",
    })

    expect((await provider.clientInformation())?.issuer).toBe("https://as.example.com/")
    expect((await provider.tokens())?.issuer).toBe("https://as.example.com/")
    expect(data["test-server"].clientInfo?.issuer).toBe("https://as.example.com/")
  })

  test("binds configured credentials without copying the secret into the store", async () => {
    const { data, store } = memoryAuth()
    const config = { clientId: "configured", clientSecret: "secret" }
    const provider = new McpOAuthProvider("test-server", serverUrl, config, { onRedirect: async () => {} }, store)
    await provider.saveClientInformation({
      client_id: "configured",
      client_secret: "secret",
      redirect_uris: [],
      issuer: "https://as.example.com/",
    })
    // A registration that would replace the configured client is not stored
    await provider.saveClientInformation({
      client_id: "other",
      redirect_uris: [],
      issuer: "https://elsewhere.example.com/",
    })

    expect(data["test-server"].clientInfo).toEqual({ clientId: "configured", issuer: "https://as.example.com/" })
    expect(await provider.clientInformation()).toEqual({
      client_id: "configured",
      client_secret: "secret",
      issuer: "https://as.example.com/",
    })
  })

  test("pending provider commits the issuer with tokens and registered client", async () => {
    const { data, store } = memoryAuth()
    const provider = new McpOAuthPendingProvider("test-server", serverUrl, {}, { onRedirect: async () => {} }, store)
    await provider.saveClientInformation({ client_id: "dyn", redirect_uris: [], issuer: "https://as.example.com/" })
    await provider.saveTokens({ access_token: "a", token_type: "Bearer", issuer: "https://as.example.com/" })
    await provider.commit()

    expect(data["test-server"].tokens?.issuer).toBe("https://as.example.com/")
    expect(data["test-server"].clientInfo?.issuer).toBe("https://as.example.com/")
  })

  test("does not send a stored refresh token to an authorization server the MCP server now advertises", async () => {
    const { store } = memoryAuth()
    const redirects: URL[] = []
    const provider = new McpOAuthProvider(
      "test-server",
      serverUrl,
      {},
      { onRedirect: async (url) => void redirects.push(url) },
      store,
    )
    await provider.saveClientInformation({ client_id: "dyn", redirect_uris: [], issuer: "https://as1.example.com/" })
    await provider.saveTokens({
      access_token: "a",
      token_type: "Bearer",
      refresh_token: "r",
      issuer: "https://as1.example.com/",
    })

    const requests: string[] = []
    const fetchFn = async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      requests.push(`${init?.method ?? "GET"} ${url.href}`)
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return Response.json({ resource: serverUrl, authorization_servers: ["https://as2.example.com"] })
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return Response.json({
          issuer: "https://as2.example.com",
          authorization_endpoint: "https://as2.example.com/authorize",
          token_endpoint: "https://as2.example.com/token",
          registration_endpoint: "https://as2.example.com/register",
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        })
      if (url.pathname === "/register")
        return Response.json({ redirect_uris: [provider.redirectUrl], client_id: "as2-client" }, { status: 201 })
      return new Response("unexpected", { status: 500 })
    }

    expect(await auth(provider, { serverUrl, fetchFn })).toBe("REDIRECT")
    expect(requests.some((r) => r.includes("/token"))).toBe(false)
    expect(redirects[0]?.host).toBe("as2.example.com")
    expect(redirects[0]?.searchParams.get("client_id")).toBe("as2-client")
    expect((await provider.clientInformation())?.issuer).toBe("https://as2.example.com")
  })
})
