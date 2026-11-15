import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk/v2/client"

type Entry = McpLocalConfig | McpRemoteConfig

/** A new server's config from the form: a command line split on spaces, or an http(s) URL. */
export function mcpEntry(kind: "local" | "remote", target: string): Entry | undefined {
  const value = target.trim()
  if (!value) return undefined
  if (kind === "remote")
    return /^https?:\/\/\S+$/i.test(value) ? { type: "remote", url: value, enabled: true } : undefined
  const command = value.split(/\s+/).filter(Boolean)
  return command.length > 0 ? { type: "local", command, enabled: true } : undefined
}

/** The configured servers, by name, with what each runs and whether it is on. Toggle-only entries are skipped. */
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

// Common servers offered as one-click adds. The remote ones ask the user to sign in once they connect.
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

/** The suggestions not already configured, under their own name or as the same command or URL. */
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
