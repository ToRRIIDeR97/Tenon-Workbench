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
