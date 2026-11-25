export * as ConfigTrust from "./trust"

import path from "path"
import { Wildcard } from "../util/wildcard"
import type { ConfigPermissionV1 } from "../v1/config/permission"
import type { ConfigV1 } from "../v1/config/config"

export const file = (data: string) => path.join(data, "trusted-folders.json")

export function parse(text: string | undefined) {
  if (!text) return []
  try {
    const list: unknown = JSON.parse(text)
    if (!Array.isArray(list)) return []
    return list.filter((item): item is string => typeof item === "string" && path.isAbsolute(item))
  } catch {
    return []
  }
}

export function covers(approved: readonly string[], target: string, paths: path.PlatformPath = path) {
  return approved.some((folder) => {
    const relative = paths.relative(folder, target)
    return (
      relative === "" || (!paths.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${paths.sep}`))
    )
  })
}

export const root = (directory: string, worktree: string) => (worktree === "/" ? directory : worktree)

export const add = (approved: readonly string[], folder: string) =>
  JSON.stringify([...new Set([...approved, folder])], null, 2)

const ENV_FILES = [".env", ".env.local", ".env.development", ".env.production", ".env.staging", ".env.test"]

export function loosens(action: string, resource: string, effect: string) {
  if (effect !== "allow") return false
  if (Wildcard.match("external_directory", action)) return true
  if (!Wildcard.match("read", action)) return false
  const name = resource.split(/[\\/]/).at(-1) ?? ""
  return /env/i.test(resource) || /[*?]$/.test(resource) || ENV_FILES.some((file) => Wildcard.match(file, name))
}

export function localInstruction(item: string) {
  if (item.startsWith("https://") || item.startsWith("http://")) return true
  return !(
    path.posix.isAbsolute(item) ||
    path.win32.isAbsolute(item) ||
    item.startsWith("~") ||
    item.split(/[\\/]/).includes("..")
  )
}

function permissionV1(permission: ConfigPermissionV1.Info) {
  const entries: [string, ConfigPermissionV1.Rule][] = []
  for (const [action, rule] of Object.entries(permission)) {
    if (typeof rule === "string") {
      if (!loosens(action, "*", rule)) entries.push([action, rule])
      continue
    }
    const kept = Object.entries(rule ?? {}).filter(([resource, effect]) => !loosens(action, resource, effect))
    if (kept.length) entries.push([action, Object.fromEntries(kept)])
  }
  return Object.fromEntries(entries) as ConfigPermissionV1.Info
}

export function agentsV1<T extends { permission?: ConfigPermissionV1.Info }>(agents: Record<string, T | undefined>) {
  return Object.fromEntries(
    Object.entries(agents).map(([name, agent]) => [
      name,
      agent?.permission ? { ...agent, permission: permissionV1(agent.permission) } : agent,
    ]),
  ) as Record<string, T>
}

export const EXTERNAL_DIRS = [".claude", ".agents"] as const
export const EXTERNAL_SKILLS = "skills/**/SKILL.md"

export const runsShell = (template: string) => /!`[^`]+`/.test(template)

export function commandsV1<T extends { template: string }>(commands: Record<string, T>) {
  const kept = Object.entries(commands).filter(([, command]) => !runsShell(command.template))
  return {
    commands: Object.fromEntries(kept) as Record<string, T>,
    withheld: kept.length < Object.keys(commands).length,
  }
}

const GATED_V1 = [
  "mcp",
  "plugin",
  "lsp",
  "formatter",
  "provider",
  "shell",
  "references",
  "reference",
  "skills",
] as const

export function projectV1<T extends ConfigV1.Info>(config: T, trusted: boolean) {
  const limited = {
    ...config,
    ...(config.permission ? { permission: permissionV1(config.permission) } : {}),
    ...(config.tools
      ? {
          tools: Object.fromEntries(
            Object.entries(config.tools).filter(([tool, on]) => !loosens(tool, "*", on ? "allow" : "deny")),
          ),
        }
      : {}),
    ...(config.agent ? { agent: agentsV1(config.agent) } : {}),
    ...(config.mode ? { mode: agentsV1(config.mode) } : {}),
  } as T
  if (trusted) return { config: limited, withheld: [] as string[] }

  const withheld: string[] = GATED_V1.filter((key) => config[key] !== undefined)
  GATED_V1.forEach((key) => delete limited[key])
  if (config.instructions) {
    limited.instructions = config.instructions.filter(localInstruction)
    if (limited.instructions.length < config.instructions.length) withheld.push("instructions")
  }
  if (config.command) {
    const commands = commandsV1(config.command)
    limited.command = commands.commands
    if (commands.withheld) withheld.push("commands")
  }
  return { config: limited, withheld }
}
