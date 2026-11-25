import { stat } from "node:fs/promises"
import path from "node:path"
import type { HarnessSyncToolID } from "@tenon/app/harness-sync/types"

export const TOOLS: ReadonlyArray<{ id: HarnessSyncToolID; name: string; command: string }> = [
  { id: "tenon", name: "Tenon", command: "" },
  { id: "claude", name: "Claude Code", command: "claude" },
  { id: "codex", name: "Codex", command: "codex" },
  { id: "opencode", name: "OpenCode", command: "opencode" },
  { id: "antigravity", name: "Antigravity", command: "agy" },
  { id: "command-code", name: "Command Code", command: "commandcode" },
]

export const findTool = (id: unknown) => TOOLS.find((tool) => tool.id === id)

export type Locations = {
  home: string
  codexHome?: string
  claudeDir?: string
  xdgConfig?: string
  pathEnv?: string
  path: path.PlatformPath
  windows: boolean
}

const absolute = (value: string | undefined, platform: path.PlatformPath) =>
  value && platform.isAbsolute(value) ? value : undefined

export function locationsFromEnv(home: string, env: NodeJS.ProcessEnv, windows = process.platform === "win32") {
  const platform = windows ? path.win32 : path.posix
  return {
    home,
    codexHome: absolute(env.CODEX_HOME, platform),
    claudeDir: absolute(env.CLAUDE_CONFIG_DIR, platform),
    xdgConfig: absolute(env.XDG_CONFIG_HOME, platform),
    pathEnv: env.PATH ?? env.Path,
    path: platform,
    windows,
  } satisfies Locations
}

export const sandboxedLocations = (home: string, windows = process.platform === "win32"): Locations => ({
  home,
  path: windows ? path.win32 : path.posix,
  windows,
})

export function configDir(locations: Locations, id: HarnessSyncToolID) {
  const join = locations.path.join
  const xdg = locations.xdgConfig ?? join(locations.home, ".config")
  if (id === "codex") return locations.codexHome ?? join(locations.home, ".codex")
  if (id === "claude") return locations.claudeDir ?? join(locations.home, ".claude")
  if (id === "opencode") return join(xdg, "opencode")
  if (id === "tenon") return join(xdg, "tenon-workbench")
  if (id === "antigravity") return join(locations.home, ".gemini")
  return join(locations.home, ".commandcode")
}

export function instructionsFile(locations: Locations, id: HarnessSyncToolID) {
  const file = id === "claude" ? "CLAUDE.md" : id === "antigravity" ? "GEMINI.md" : "AGENTS.md"
  return locations.path.join(configDir(locations, id), file)
}

export const skillsDir = (locations: Locations, id: HarnessSyncToolID) =>
  id === "antigravity"
    ? locations.path.join(configDir(locations, id), "antigravity", "skills")
    : locations.path.join(configDir(locations, id), "skills")

const isDir = (dir: string) =>
  stat(dir).then(
    (info) => info.isDirectory(),
    () => false,
  )
const isFile = (file: string) =>
  stat(file).then(
    (info) => info.isFile(),
    () => false,
  )

export async function installed(locations: Locations, id: HarnessSyncToolID) {
  if (id === "tenon") return true
  if (await isDir(configDir(locations, id))) return true
  const command = findTool(id)?.command
  if (!command || !locations.pathEnv) return false
  const names = locations.windows ? ["exe", "cmd", "bat", "ps1"].map((ext) => `${command}.${ext}`) : [command]
  const delimiter = locations.windows ? ";" : ":"
  const candidates = locations.pathEnv
    .split(delimiter)
    .filter(Boolean)
    .flatMap((dir) => names.map((name) => locations.path.join(dir, name)))
  const found = await Promise.all(candidates.map(isFile))
  return found.includes(true)
}
