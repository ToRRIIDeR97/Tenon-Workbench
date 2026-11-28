import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import {
  OpenCode,
  type OpenCodeClient,
  type SessionCreateInput,
  type SessionInfo,
  type SessionPromptInput,
} from "@opencode-ai/client/promise"
import type { VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { Harness } from "@tenon/schema/harness"
import { Harness as HarnessSchema } from "@tenon/schema/harness"
import { Location } from "@tenon/schema/location"
import { Skill as SkillSchema } from "@tenon/schema/skill"
import { Schema } from "effect"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
}

export type ServerApi = OpenCodeClient

export type HarnessSessionCreateInput = SessionCreateInput & {
  readonly harnessInstanceID?: Harness.InstanceID
  readonly harnessModel?: Harness.ModelSelection
}

export class SessionCreateError extends Error {
  readonly status?: number

  constructor(status?: number) {
    super()
    this.name = "SessionCreateError"
    this.status = status
  }
}

const decodeHarnessResponse = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.Instance)))

export function fallbackHarnesses(): ReadonlyArray<Harness.Instance> {
  return [
    HarnessSchema.Instance.make({
      id: HarnessSchema.OpenCode,
      driver: HarnessSchema.OpenCodeDriver,
      name: "Default agent",
      status: "available",
      models: [],
    }),
    HarnessSchema.Instance.make({
      id: HarnessSchema.Codex,
      driver: HarnessSchema.CodexDriver,
      name: "Codex",
      status: "unavailable",
      models: [],
    }),
    HarnessSchema.Instance.make({
      id: HarnessSchema.OpenCodeAcp,
      driver: HarnessSchema.AcpDriver,
      name: "OpenCode",
      status: "unavailable",
      models: [],
    }),
    HarnessSchema.Instance.make({
      id: HarnessSchema.ClaudeCode,
      driver: HarnessSchema.AcpDriver,
      name: "Claude Code",
      status: "unavailable",
      models: [],
    }),
  ]
}

export async function listHarnessesForServer(
  input: {
    server: ServerConnection.HttpBase
    fetch?: typeof globalThis.fetch
  },
  directory: string,
) {
  const url = new URL(`${input.server.url.replace(/\/+$/, "")}/api/harness`)
  url.searchParams.set("location[directory]", directory)
  const response = await (input.fetch ?? globalThis.fetch)(url, {
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
  if (!response.ok) throw new Error(`Harness availability check failed (${response.status}).`)
  return decodeHarnessResponse(await response.json()).data
}

const recentHarnesses = new Map<string, ReadonlyArray<HarnessSchema.Instance>>()
export const recentHarnessKey = (server: string, directory: string) => `${server}\n${directory}`

const latestHarnesses = new Map<string, ReadonlyArray<HarnessSchema.Instance>>()

export function rememberedHarnesses(url: string, directory: string) {
  return recentHarnesses.get(recentHarnessKey(url, directory)) ?? latestHarnesses.get(url)
}

const HARNESS_REUSE_MS = 30_000
const harnessChecks = new Map<string, Promise<ReadonlyArray<HarnessSchema.Instance> | undefined>>()
const harnessCheckedAt = new Map<string, number>()

export async function listHarnessesRemembered(
  input: Parameters<typeof listHarnessesForServer>[0],
  directory: string,
  keep?: (list: ReadonlyArray<HarnessSchema.Instance>) => void,
  options: { reuse?: boolean } = {},
) {
  const key = recentHarnessKey(input.server.url, directory)
  const fresh = recentHarnesses.get(key)
  if (options.reuse && fresh && Date.now() - (harnessCheckedAt.get(key) ?? 0) < HARNESS_REUSE_MS) {
    keep?.(fresh)
    return fresh
  }
  const running = options.reuse ? harnessChecks.get(key) : undefined
  const check =
    running ??
    listHarnessesForServer(input, directory)
      .catch(() => undefined)
      .finally(() => harnessChecks.delete(key))
  if (!running) harnessChecks.set(key, check)
  const list = await check
  if (!list) {
    const last = rememberedHarnesses(input.server.url, directory)
    if (last) return last
    throw new Error("Harness availability check failed.")
  }
  recentHarnesses.set(key, list)
  harnessCheckedAt.set(key, Date.now())
  latestHarnesses.set(input.server.url, list)
  keep?.(list)
  return list
}

const decodeSettingsList = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.SettingsEntry)))
const decodeSettingsEntry = Schema.decodeUnknownSync(Location.response(HarnessSchema.SettingsEntry))
const decodeDiscovery = Schema.decodeUnknownSync(Location.response(HarnessSchema.Discovery))

export type HarnessServer = {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}

function harnessSettingsRequest(input: HarnessServer, directory: string, route: string, init?: RequestInit) {
  return locationRequest(input, directory, `/api/harness${route}`, "Harness request failed", init)
}

async function locationRequest(
  input: HarnessServer,
  directory: string,
  route: string,
  failure: string,
  init?: RequestInit,
) {
  const url = new URL(`${input.server.url.replace(/\/+$/, "")}${route}`)
  if (directory) url.searchParams.set("location[directory]", directory)
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set("content-type", "application/json")
  if (input.server.password)
    headers.set(
      "Authorization",
      `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
    )
  const response = await (input.fetch ?? globalThis.fetch)(url, { ...init, headers })
  const body: unknown = await response.json().catch(() => undefined)
  if (response.ok) return body
  const message =
    typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
      ? body.message
      : `${failure} (${response.status}).`
  throw new Error(message)
}

export async function getComputerUse(input: HarnessServer, folder: string) {
  const body = await locationRequest(input, folder, "/api/computer-use", "Computer use request failed")
  return (body as { data: import("@/features/second-brain/project-computer-use-model").ComputerUseState }).data
}

export async function setComputerUse(input: HarnessServer, folder: string, enabled: boolean) {
  const body = await locationRequest(input, folder, "/api/computer-use", "Computer use request failed", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  })
  return (body as { data: import("@/features/second-brain/project-computer-use-model").ComputerUseState }).data
}

export async function projectGithubWork(
  input: HarnessServer,
  folder: string,
  options: { repo?: string; save?: boolean; refresh?: boolean } = {},
) {
  const body = await locationRequest(input, folder, "/api/github/work", "GitHub request failed", {
    method: "POST",
    body: JSON.stringify(options),
  })
  return (body as { data: import("@/features/second-brain/github-tasks").GithubWork }).data
}

export async function removeMcpServer(input: HarnessServer, name: string) {
  const body = await locationRequest(
    input,
    "",
    `/global/config/mcp/${encodeURIComponent(name)}`,
    "MCP request failed",
    {
      method: "DELETE",
    },
  )
  return typeof body === "object" && body !== null && "changed" in body && body.changed === true
}

export async function mcpToolNames(input: HarnessServer, directory: string) {
  const body = await locationRequest(
    input,
    "",
    `/mcp/tools?directory=${encodeURIComponent(directory)}`,
    "MCP request failed",
  )
  return (typeof body === "object" && body !== null ? body : {}) as Record<string, string[]>
}

export async function mcpSecretNames(input: HarnessServer, name: string) {
  const body = await locationRequest(
    input,
    "",
    `/global/config/mcp/${encodeURIComponent(name)}/names`,
    "MCP request failed",
  )
  const value = (body ?? {}) as { environment?: string[]; headers?: string[] }
  return { environment: value.environment ?? [], headers: value.headers ?? [] }
}

export async function editMcpServer(
  input: HarnessServer,
  name: string,
  change: { rename?: string; clear?: ReadonlyArray<string> },
) {
  const body = await locationRequest(
    input,
    "",
    `/global/config/mcp/${encodeURIComponent(name)}/edit`,
    "MCP request failed",
    { method: "POST", body: JSON.stringify(change) },
  )
  const value = (body ?? {}) as { changed?: boolean; error?: string }
  if (value.error) throw new Error(value.error)
  return value.changed === true
}

const decodeSkillCatalog = Schema.decodeUnknownSync(Location.response(SkillSchema.Catalog))

export async function listSkillCatalog(input: HarnessServer, directory: string) {
  return decodeSkillCatalog(await locationRequest(input, directory, "/api/skill/catalog", "Skills request failed")).data
}

const decodeSkillEnabled = Schema.decodeUnknownSync(
  Location.response(Schema.Struct({ name: Schema.String, enabled: Schema.Boolean })),
)

const decodeSkills = Schema.decodeUnknownSync(Location.response(Schema.Array(SkillSchema.Info)))

export async function listSkills(input: HarnessServer, directory: string) {
  return decodeSkills(await locationRequest(input, directory, "/api/skill", "Skills request failed")).data
}

export async function setSkillEnabled(
  input: HarnessServer,
  directory: string,
  name: string,
  enabled: boolean,
  harness?: string,
) {
  return decodeSkillEnabled(
    await locationRequest(input, directory, "/api/skill/enabled", "Skills request failed", {
      method: "POST",
      body: JSON.stringify(harness === undefined ? { name, enabled } : { name, enabled, harness }),
    }),
  ).data
}

export async function listHarnessSettings(input: HarnessServer, directory: string) {
  return decodeSettingsList(await harnessSettingsRequest(input, directory, "/settings")).data
}

const decodeTitleAgent = Schema.decodeUnknownSync(
  Location.response(Schema.Struct({ id: Schema.optional(HarnessSchema.InstanceID) })),
)

export async function getTitleAgent(input: HarnessServer, directory: string) {
  return decodeTitleAgent(await harnessSettingsRequest(input, directory, "/title-agent")).data.id
}

export async function setTitleAgent(input: HarnessServer, directory: string, id: string | undefined) {
  return decodeTitleAgent(
    await harnessSettingsRequest(input, directory, "/title-agent", { method: "PUT", body: JSON.stringify({ id }) }),
  ).data.id
}

export async function discoverHarness(input: HarnessServer, directory: string, value: HarnessSchema.DiscoverInput) {
  return decodeDiscovery(
    await harnessSettingsRequest(input, directory, "/discover", { method: "POST", body: JSON.stringify(value) }),
  ).data
}

const decodeAssistantDirectory = Schema.decodeUnknownSync(
  Location.response(Schema.Struct({ directory: Schema.String })),
)

export async function harnessAssistantDirectory(input: HarnessServer, directory: string) {
  return decodeAssistantDirectory(await harnessSettingsRequest(input, directory, "/assistant-directory")).data.directory
}

const decodeVerification = Schema.decodeUnknownSync(Location.response(HarnessSchema.Verification))

export async function verifyHarness(input: HarnessServer, directory: string, value: HarnessSchema.VerifyInput) {
  return decodeVerification(
    await harnessSettingsRequest(input, directory, "/verify", { method: "POST", body: JSON.stringify(value) }),
  ).data
}

export async function addHarness(input: HarnessServer, directory: string, value: HarnessSchema.SettingsInput) {
  return decodeSettingsEntry(
    await harnessSettingsRequest(input, directory, "/registry", { method: "POST", body: JSON.stringify(value) }),
  ).data
}

export async function setHarnessEnabled(input: HarnessServer, directory: string, id: string, enabled: boolean) {
  return decodeSettingsEntry(
    await harnessSettingsRequest(input, directory, `/registry/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  ).data
}

export async function removeHarness(input: HarnessServer, directory: string, id: string) {
  await harnessSettingsRequest(input, directory, `/registry/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export async function refreshHarnesses(input: HarnessServer, directory: string, id?: string) {
  return decodeHarnessResponse(
    await harnessSettingsRequest(input, directory, "/refresh", { method: "POST", body: JSON.stringify({ id }) }),
  ).data
}

const decodeSetupList = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.SetupStatus)))
const decodeSetup = Schema.decodeUnknownSync(Location.response(HarnessSchema.SetupStatus))
const decodeSignIn = Schema.decodeUnknownSync(Location.response(HarnessSchema.SignIn))
const setupPath = (id: string, action: string) => `/setup/${encodeURIComponent(id)}/${action}`

export async function listHarnessSetup(input: HarnessServer, directory: string) {
  return decodeSetupList(await harnessSettingsRequest(input, directory, "/setup")).data
}

export async function installHarness(input: HarnessServer, directory: string, id: string) {
  return decodeSetup(await harnessSettingsRequest(input, directory, setupPath(id, "install"), { method: "POST" })).data
}

export async function signInHarness(input: HarnessServer, directory: string, id: string) {
  return decodeSignIn(await harnessSettingsRequest(input, directory, setupPath(id, "sign-in"), { method: "POST" })).data
}

export async function setHarnessApiKey(
  input: HarnessServer,
  directory: string,
  id: string,
  value: HarnessSchema.ApiKeyInput,
) {
  return decodeSetup(
    await harnessSettingsRequest(input, directory, setupPath(id, "api-key"), {
      method: "PUT",
      body: JSON.stringify(value),
    }),
  ).data
}

export async function removeHarnessApiKey(input: HarnessServer, directory: string, id: string) {
  return decodeSetup(await harnessSettingsRequest(input, directory, setupPath(id, "api-key"), { method: "DELETE" }))
    .data
}

const decodeUpdates = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.UpdateStatus)))
const decodeUpdate = Schema.decodeUnknownSync(Location.response(HarnessSchema.UpdateStatus))

export async function listHarnessUpdates(input: HarnessServer, directory: string) {
  return decodeUpdates(await harnessSettingsRequest(input, directory, "/updates")).data
}

const decodeUsage = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.UsageReport)))

export async function listHarnessUsage(input: HarnessServer, directory: string) {
  return decodeUsage(await harnessSettingsRequest(input, directory, "/usage")).data
}

export async function listBranches(input: HarnessServer, directory: string) {
  const body = await instanceRequest(input, directory, "/vcs/branches", "Couldn't list branches")
  return Array.isArray(body) ? body.filter((item): item is string => typeof item === "string") : []
}

export async function currentBranch(input: HarnessServer, directory: string) {
  const body = await instanceRequest(input, directory, "/vcs", "Couldn't read the branch")
  const branch = body && typeof body === "object" ? (body as { branch?: unknown }).branch : undefined
  return typeof branch === "string" && branch ? branch : null
}

export async function switchBranch(input: HarnessServer, directory: string, branch: string) {
  await instanceRequest(input, directory, "/vcs/branch", "Couldn't switch branch", {
    method: "POST",
    body: JSON.stringify({ branch }),
  })
}

export async function vcsInfo(input: HarnessServer, directory: string) {
  const body = await instanceRequest(input, directory, "/vcs", "Couldn't read the branch")
  const value = body && typeof body === "object" ? (body as { branch?: unknown; default_branch?: unknown }) : {}
  return {
    branch: typeof value.branch === "string" && value.branch ? value.branch : null,
    defaultBranch: typeof value.default_branch === "string" && value.default_branch ? value.default_branch : null,
  }
}

export async function commitChanges(
  input: HarnessServer,
  directory: string,
  payload: { message: string; branch?: string },
) {
  const body = await instanceRequest(input, directory, "/vcs/commit", "Couldn't commit", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  const value = body && typeof body === "object" ? (body as { sha?: unknown; branch?: unknown }) : {}
  return { sha: String(value.sha ?? ""), branch: String(value.branch ?? "") }
}

export async function pushBranch(input: HarnessServer, directory: string) {
  const body = await instanceRequest(input, directory, "/vcs/push", "Couldn't push", { method: "POST" })
  const value = body && typeof body === "object" ? (body as { branch?: unknown }) : {}
  return { branch: String(value.branch ?? "") }
}

export async function openPullRequest(
  input: HarnessServer,
  directory: string,
  payload: { title: string; body: string; base?: string; draft: boolean },
) {
  const body = await instanceRequest(input, directory, "/vcs/pr", "Couldn't open the pull request", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  const value = body && typeof body === "object" ? (body as { url?: unknown }) : {}
  return { url: String(value.url ?? "") }
}

async function instanceRequest(
  input: HarnessServer,
  directory: string,
  route: string,
  failure: string,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers)
  headers.set("x-opencode-directory", encodeURIComponent(directory))
  if (init?.body !== undefined) headers.set("content-type", "application/json")
  if (input.server.password)
    headers.set(
      "Authorization",
      `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
    )
  const response = await (input.fetch ?? globalThis.fetch)(`${input.server.url.replace(/\/+$/, "")}${route}`, {
    ...init,
    headers,
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (response.ok) return body
  const data = typeof body === "object" && body !== null && "data" in body ? body.data : undefined
  const message =
    typeof data === "object" && data !== null && "message" in data && typeof data.message === "string"
      ? data.message
      : `${failure} (${response.status}).`
  throw new Error(message)
}

export async function upgradeHarness(input: HarnessServer, directory: string, id: string) {
  return decodeUpdate(
    await harnessSettingsRequest(input, directory, `/upgrade/${encodeURIComponent(id)}`, { method: "POST" }),
  ).data
}

export async function createSessionForServer(
  input: {
    server: ServerConnection.HttpBase
    fetch?: typeof globalThis.fetch
  },
  value?: HarnessSessionCreateInput,
): Promise<SessionInfo> {
  const response = await (input.fetch ?? globalThis.fetch)(`${input.server.url.replace(/\/+$/, "")}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.server.password
        ? {
            Authorization: `Basic ${authTokenFromCredentials({
              username: input.server.username,
              password: input.server.password,
            })}`,
          }
        : {}),
    },
    body: JSON.stringify(value ?? {}),
  }).catch(() => {
    throw new SessionCreateError()
  })
  if (!response.ok) throw new SessionCreateError(response.status)
  const payload: unknown = await response.json().catch(() => {
    throw new SessionCreateError(response.status)
  })
  if (!isRecord(payload) || !isRecord(payload.data)) throw new SessionCreateError()
  return payload.data as SessionInfo
}

export async function promptSessionForServer(
  input: {
    server: ServerConnection.HttpBase
    fetch?: typeof globalThis.fetch
  },
  value: SessionPromptInput & {
    model?: { providerID: string; modelID: string }
    variant?: string
    harness?: boolean
  },
) {
  const base = `${input.server.url.replace(/\/+$/, "")}/api/session/${encodeURIComponent(value.sessionID)}`
  const headers = {
    "content-type": "application/json",
    ...(input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : {}),
  }
  if (value.model && !value.harness) {
    const switched = await (input.fetch ?? globalThis.fetch)(`${base}/model`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: { id: value.model.modelID, providerID: value.model.providerID, variant: value.variant },
      }),
    })
    if (!switched.ok) throw new Error(`Model switch failed (${switched.status}).`)
  }
  const response = await (input.fetch ?? globalThis.fetch)(`${base}/prompt`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: value.id,
      prompt: {
        text: value.text,
        files: value.files?.map((file) => ({
          uri: file.uri,
          name: file.name,
          description: file.description,
          source: file.mention,
        })),
        agents: value.agents?.map((agent) => ({ name: agent.name, source: agent.mention })),
      },
      delivery: value.delivery,
      resume: value.resume,
    }),
  })
  if (!response.ok) throw new Error(`Harness prompt failed (${response.status}).`)
}

export async function switchHarnessForServer(
  input: {
    server: ServerConnection.HttpBase
    fetch?: typeof globalThis.fetch
  },
  sessionID: string,
  value: { instanceID: Harness.InstanceID; model?: Harness.ModelSelection },
) {
  const response = await (input.fetch ?? globalThis.fetch)(
    `${input.server.url.replace(/\/+$/, "")}/api/session/${encodeURIComponent(sessionID)}/harness`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.server.password
          ? {
              Authorization: `Basic ${authTokenFromCredentials({
                username: input.server.username,
                password: input.server.password,
              })}`,
            }
          : {}),
      },
      body: JSON.stringify(value),
    },
  )
  if (!response.ok) throw new Error(`Harness switch failed (${response.status}).`)
}

export async function compactHarnessForServer(
  input: { server: ServerConnection.HttpBase; fetch?: typeof globalThis.fetch },
  sessionID: string,
  model?: Harness.ModelSelection,
) {
  const response = await (input.fetch ?? globalThis.fetch)(
    `${input.server.url.replace(/\/+$/, "")}/api/session/${encodeURIComponent(sessionID)}/compact`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.server.password
          ? {
              Authorization: `Basic ${authTokenFromCredentials({
                username: input.server.username,
                password: input.server.password,
              })}`,
            }
          : {}),
      },
      body: JSON.stringify(model ? { model } : {}),
    },
  )
  if (response.ok) return
  const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined
  throw new Error(body?.message ?? `Compaction failed (${response.status}).`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function sessionDiffForServer(
  input: { server: ServerConnection.HttpBase; fetch?: typeof globalThis.fetch },
  value: { sessionID: string; messageID: string },
): Promise<VcsFileDiff[]> {
  const url = new URL(`${input.server.url.replace(/\/+$/, "")}/api/session/${encodeURIComponent(value.sessionID)}/diff`)
  url.searchParams.set("messageID", value.messageID)
  const response = await (input.fetch ?? globalThis.fetch)(url, {
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
        }
      : undefined,
  })
  if (!response.ok) throw new Error(`Session diff failed (${response.status})`)
  const payload = (await response.json()) as {
    data: {
      path: string
      patch: string
      additions: number
      deletions: number
      status: "added" | "modified" | "deleted"
    }[]
  }
  return payload.data.map(({ path, ...diff }) => ({ ...diff, file: path }))
}
