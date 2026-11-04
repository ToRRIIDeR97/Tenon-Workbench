export * as ConfigTrust from "./trust"

import path from "path"
import { Wildcard } from "../util/wildcard"
import type { ConfigPermissionV1 } from "../v1/config/permission"
import type { ConfigV1 } from "../v1/config/config"

/** The approved folders, one JSON array in the data folder. The user adds to it from the app's prompt only. */
export const file = (data: string) => path.join(data, "trusted-folders.json")

/** Anything unreadable reads as an empty list, so a damaged file leaves the gate shut. */
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

/** Whether `target` is an approved folder or inside one. `path.relative` handles Windows case and separators. */
export function covers(approved: readonly string[], target: string, paths: path.PlatformPath = path) {
  return approved.some((folder) => {
    const relative = paths.relative(folder, target)
    return (
      relative === "" || (!paths.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${paths.sep}`))
    )
  })
}

/** The folder one approval covers: the repository, or the opened folder when there is no repository. */
export const root = (directory: string, worktree: string) => (worktree === "/" ? directory : worktree)

export const add = (approved: readonly string[], folder: string) =>
  JSON.stringify([...new Set([...approved, folder])], null, 2)

const ENV_FILES = [".env", ".env.local", ".env.development", ".env.production"]

/** Whether one project permission rule would widen `external_directory` or reads of `.env` files. */
export function loosens(action: string, resource: string, effect: string) {
  if (effect !== "allow") return false
  if (Wildcard.match("external_directory", action)) return true
  if (!Wildcard.match("read", action)) return false
  // A pattern that ends in a wildcard or names env could reach a `.env` file wherever it is.
  const name = resource.split(/[\/]/).at(-1) ?? ""
  return /env/i.test(resource) || /[*?]$/.test(resource) || ENV_FILES.some((file) => Wildcard.match(file, name))
}

/** Local instructions stay; absolute, home and parent paths could read a secret into the prompt. */
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

/** Refuses loosening entries in the markdown and JSON agents a project defines. */
export function agentsV1<T extends { permission?: ConfigPermissionV1.Info }>(agents: Record<string, T | undefined>) {
  return Object.fromEntries(
    Object.entries(agents).map(([name, agent]) => [
      name,
      agent?.permission ? { ...agent, permission: permissionV1(agent.permission) } : agent,
    ]),
  ) as Record<string, T>
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

/**
 * What a project file may contribute. `withheld` names what stays off until the folder is approved;
 * permission entries that widen `external_directory` or `.env` reads are refused even after approval.
 */
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
  return { config: limited, withheld }
}
