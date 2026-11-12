export * as HarnessForwardedMcp from "./forwarded-mcp"

import path from "path"
import type { Config } from "../config"
import type { ConfigMCP } from "../config/mcp"
import type { McpServer } from "./acp"

/**
 * The MCP servers added in Settings › MCP servers, passed on to the external harnesses (Codex, Claude Code and the
 * other ACP agents) so they see the same servers as Tenon's built-in agent. The servers come from the config
 * documents, which already drop `mcp` from folders the user hasn't trusted; switched-off servers are left out.
 * Secrets (environment values and headers) never go on a command line: Codex reads them from its own environment by
 * name, and ACP agents receive them over the stdio protocol.
 */

// Tenon's own delegation server; a user entry of the same name would hide it.
const RESERVED = "tenon"
// Codex `-c` keys are dotted TOML paths, so a server name must be a bare TOML key.
const BARE_KEY = /^[A-Za-z0-9_-]{1,64}$/

type Server = ConfigMCP.Local | ConfigMCP.Remote

/** The enabled servers by name, later config documents overriding earlier ones. */
export function servers(entries: ReadonlyArray<Config.Entry>): ReadonlyArray<readonly [string, Server]> {
  const merged = new Map<string, Server>()
  for (const entry of entries) {
    if (entry.type !== "document") continue
    for (const [name, server] of Object.entries(entry.info.mcp?.servers ?? {})) merged.set(name, server)
  }
  return [...merged].filter(([name, server]) => name !== RESERVED && BARE_KEY.test(name) && server.disabled !== true)
}

/** Codex `-c` overrides plus the environment that carries their secret values. */
export function codex(list: ReadonlyArray<readonly [string, Server]>, directory: string) {
  const args: string[] = []
  const env: Record<string, string> = {}
  list.forEach(([name, server], index) => {
    const key = `mcp_servers.${name}`
    const set = (field: string, value: string) => args.push("-c", `${key}.${field}=${value}`)
    const secret = (field: string, value: string) => {
      const variable = `TENON_MCP_${index}_${field.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`
      env[variable] = value
      return variable
    }
    if (server.type === "local") {
      const [command, ...rest] = server.command
      if (!command) return
      set("command", toml(command))
      set("args", `[${rest.map(toml).join(", ")}]`)
      if (server.cwd) set("cwd", toml(path.resolve(directory, server.cwd)))
      const names = Object.entries(server.environment ?? {}).map(([variable, value]) => {
        env[variable] = value
        return variable
      })
      if (names.length) set("env_vars", `[${names.map(toml).join(", ")}]`)
      return
    }
    set("url", toml(server.url))
    const headers = Object.entries(server.headers ?? {})
    if (headers.length)
      set(
        "env_http_headers",
        `{ ${headers.map(([header, value]) => `${toml(header)} = ${toml(secret(header, value))}`).join(", ")} }`,
      )
  })
  return { args, env }
}

/**
 * ACP `session/new` entries. Every ACP agent must accept stdio servers; HTTP ones are dropped later when the agent
 * doesn't advertise `mcpCapabilities.http`.
 */
export function acp(list: ReadonlyArray<readonly [string, Server]>): McpServer[] {
  return list.flatMap(([name, server]): McpServer[] => {
    if (server.type === "local") {
      const [command, ...args] = server.command
      if (!command) return []
      return [
        // ACP's stdio entry has no `type` and no working directory: the agent starts it in the session's folder.
        {
          name,
          command,
          args,
          env: Object.entries(server.environment ?? {}).map(([variable, value]) => ({ name: variable, value })),
        },
      ]
    }
    return [
      {
        type: "http",
        name,
        url: server.url,
        headers: Object.entries(server.headers ?? {}).map(([header, value]) => ({ name: header, value })),
      },
    ]
  })
}

// JSON string escaping is valid for a TOML basic string.
function toml(value: string) {
  return JSON.stringify(value)
}
