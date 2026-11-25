import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk/v2/client"

type Entry = McpLocalConfig | McpRemoteConfig

export function mcpEntry(kind: "local" | "remote", target: string): Entry | undefined {
  const value = target.trim()
  if (!value) return undefined
  if (kind === "remote")
    return /^https?:\/\/\S+$/i.test(value) ? { type: "remote", url: value, enabled: true } : undefined
  const command = value.split(/\s+/).filter(Boolean)
  return command.length > 0 ? { type: "local", command, enabled: true } : undefined
}

export function mcpRows(config: Record<string, Entry | { enabled: boolean }> | undefined) {
  return Object.entries(config ?? {})
    .flatMap(([name, entry]) => {
      if (!("type" in entry)) return []
      return [
        {
          name,
          entry,
          enabled: entry.enabled !== false,
          detail: entry.type === "local" ? entry.command.join(" ") : entry.url,
        },
      ]
    })
    .toSorted((a, b) => a.name.localeCompare(b.name))
}

export type McpSuggestion = {
  id: "playwright" | "context7" | "github" | "linear" | "sentry"
  entry: Entry
  signIn: boolean
}

const SUGGESTIONS: ReadonlyArray<McpSuggestion> = [
  {
    id: "playwright",
    entry: { type: "local", command: ["npx", "@playwright/mcp@latest"], enabled: true },
    signIn: false,
  },
  { id: "context7", entry: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true }, signIn: false },
  { id: "github", entry: { type: "remote", url: "https://api.githubcopilot.com/mcp/", enabled: true }, signIn: true },
  { id: "linear", entry: { type: "remote", url: "https://mcp.linear.app/mcp", enabled: true }, signIn: true },
  { id: "sentry", entry: { type: "remote", url: "https://mcp.sentry.dev/mcp", enabled: true }, signIn: true },
]

export function mcpSuggestions(config: Record<string, Entry | { enabled: boolean }> | undefined) {
  const installed = Object.entries(config ?? {})
  const target = (entry: Entry) => (entry.type === "local" ? entry.command.join(" ") : entry.url)
  return SUGGESTIONS.filter(
    (suggestion) =>
      !installed.some(
        ([name, entry]) => name === suggestion.id || ("type" in entry && target(entry) === target(suggestion.entry)),
      ),
  )
}

const RESERVED = "tenon"
const BARE_KEY = /^[A-Za-z0-9_-]{1,64}$/

type LiveStatus =
  | { status: "connected" | "disabled" | "needs_auth" | "pending" }
  | { status: "failed" | "needs_client_registration"; error: string }

export type McpRowState =
  | { kind: "connected" }
  | { kind: "off" }
  | { kind: "unknown" }
  | { kind: "pending" }
  | { kind: "needs_auth"; action: "signin" }
  | { kind: "failed"; error: string; action: "retry" }

export function mcpRowState(status: LiveStatus | { status: string; error?: string } | undefined): McpRowState {
  if (!status) return { kind: "unknown" }
  if (status.status === "connected") return { kind: "connected" }
  if (status.status === "disabled") return { kind: "off" }
  if (status.status === "pending") return { kind: "pending" }
  if (status.status === "needs_auth") return { kind: "needs_auth", action: "signin" }
  if (status.status === "failed" || status.status === "needs_client_registration")
    return { kind: "failed", error: ("error" in status && status.error) || "", action: "retry" }
  return { kind: "unknown" }
}

export function mcpReach(name: string, entry: Entry, harnesses: ReadonlyArray<{ name: string; driver: string }>) {
  const result = {
    receives: [] as string[],
    missing: [] as { harness: string; reason: "name" }[],
    maybe: [] as string[],
  }
  if (entry.enabled === false) return result
  for (const harness of harnesses) {
    if (harness.driver === "opencode") {
      result.receives.push(harness.name)
      continue
    }
    if (name === RESERVED || !BARE_KEY.test(name)) {
      result.missing.push({ harness: harness.name, reason: "name" })
      continue
    }
    if (entry.type === "remote" && harness.driver === "acp") {
      result.maybe.push(harness.name)
      continue
    }
    result.receives.push(harness.name)
  }
  return result
}

type Pair = { key: string; value: string }
export type McpForm =
  | { kind: "local"; command: string; args: string[]; env?: Pair[]; cwd?: string; timeout?: string }
  | { kind: "remote"; url: string; headers?: Pair[]; timeout?: string }
  | { kind: "json"; json: string }

export function mcpEntryFromForm(form: McpForm): Entry | undefined {
  if (form.kind === "json") return pasted(form.json)
  const timeout = seconds(form.timeout)
  if (timeout === null) return undefined
  if (form.kind === "remote") {
    const url = form.url.trim()
    if (!/^https?:\/\/\S+$/i.test(url)) return undefined
    const headers = pairs(form.headers)
    return {
      type: "remote",
      url,
      ...(headers ? { headers } : {}),
      ...(timeout === undefined ? {} : { timeout }),
      enabled: true,
    }
  }
  const command = form.command.trim()
  if (!command) return undefined
  const environment = pairs(form.env)
  const cwd = form.cwd?.trim()
  return {
    type: "local",
    command: [command, ...form.args.filter((arg) => arg.length > 0)],
    ...(environment ? { environment } : {}),
    ...(cwd ? { cwd } : {}),
    ...(timeout === undefined ? {} : { timeout }),
    enabled: true,
  }
}

export function mcpNameProblem(name: string, taken: ReadonlyArray<string>) {
  const value = name.trim()
  if (!value) return "empty" as const
  if (taken.includes(value)) return "taken" as const
  if (value === RESERVED) return "reserved" as const
  return undefined
}

function pairs(list: Pair[] | undefined) {
  const entries = (list ?? []).flatMap((item) => (item.key.trim() ? [[item.key.trim(), item.value] as const] : []))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function seconds(value: string | undefined) {
  if (!value?.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number * 1000) : null
}

function pasted(json: string): Entry | undefined {
  const value = (() => {
    try {
      return JSON.parse(json) as unknown
    } catch {
      return undefined
    }
  })()
  if (!value || typeof value !== "object") return undefined
  const entry = value as Record<string, unknown>
  if (entry.type === "local" && Array.isArray(entry.command) && entry.command.length > 0)
    return { ...(entry as McpLocalConfig), enabled: entry.enabled !== false }
  if (entry.type === "remote" && typeof entry.url === "string" && /^https?:\/\//i.test(entry.url))
    return { ...(entry as McpRemoteConfig), enabled: entry.enabled !== false }
  return undefined
}
