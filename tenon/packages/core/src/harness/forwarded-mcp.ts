export * as HarnessForwardedMcp from "./forwarded-mcp"

import path from "path"
import type { Config } from "../config"
import type { ConfigMCP } from "../config/mcp"
import type { McpServer } from "./acp"

const RESERVED = "tenon"
const BARE_KEY = /^[A-Za-z0-9_-]{1,64}$/

type Server = ConfigMCP.Local | ConfigMCP.Remote

export function servers(entries: ReadonlyArray<Config.Entry>): ReadonlyArray<readonly [string, Server]> {
  const merged = new Map<string, Server>()
  for (const entry of entries) {
    if (entry.type !== "document") continue
    for (const [name, server] of Object.entries(entry.info.mcp?.servers ?? {})) merged.set(name, server)
  }
  return [...merged].filter(([name, server]) => name !== RESERVED && BARE_KEY.test(name) && server.disabled !== true)
}

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

export function acp(list: ReadonlyArray<readonly [string, Server]>): McpServer[] {
  return list.flatMap(([name, server]): McpServer[] => {
    if (server.type === "local") {
      const [command, ...args] = server.command
      if (!command) return []
      return [
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

function toml(value: string) {
  return JSON.stringify(value)
}
