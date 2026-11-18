export * as HarnessComputerUse from "./computer-use"

import { execFile } from "child_process"
import fs from "fs/promises"
import path from "path"
import { Harness } from "@tenon/schema/harness"
import { which } from "../util/which"
import type { McpServer } from "./acp"

// Computer use for harnesses that don't bring their own (#333): a Project switches it on, and its threads get the
// Cua Driver (trycua, MIT) as an MCP server, `cua-driver mcp`. The driver sees and drives the whole desktop in the
// background without taking the cursor. Codex and Claude Code have their own and are never given a second one.
// Off by default; the folders that have it on live in `computer-use.json` in Tenon's config folder.

const FILE = "computer-use.json"
const NATIVE = new Set<string>([Harness.Codex, Harness.ClaudeCode])

/** The MCP server a thread gets, or undefined when the Project has it off, the driver is missing or it's native. */
export function serverFor(
  harness: Harness.InstanceID,
  enabled: boolean,
  driver: string | undefined,
): McpServer | undefined {
  if (!enabled || !driver || NATIVE.has(harness)) return undefined
  return { name: "computer", command: driver, args: ["mcp"], env: [] }
}

/** The installed `cua-driver`, found on PATH and the Windows install folders. */
export const findDriver = () => which("cua-driver") ?? undefined

/** One folder, whatever the slashes; on Windows whatever the case. */
export function sameFolder(a: string, b: string, api: Pick<typeof path, "resolve" | "sep"> = path) {
  const normal = (value: string) => {
    const resolved = api.resolve(value.replace(/[\\/]+$/, "") || value)
    return api.sep === "\\" ? resolved.toLowerCase() : resolved
  }
  return normal(a) === normal(b)
}

async function folders(configDir: string) {
  const text = await fs.readFile(path.join(configDir, FILE), "utf8").catch(() => "")
  const value: unknown = text ? JSON.parse(text) : {}
  const list = typeof value === "object" && value !== null ? (value as { folders?: unknown }).folders : undefined
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []
}

/** True when `folder` is an enabled Project folder or inside one (a subfolder, or a worktree kept inside it). */
export async function enabledFor(folder: string, configDir: string) {
  return (await folders(configDir)).some((item) => sameFolder(item, folder) || inside(item, folder))
}

/** True when `folder` sits inside `parent`, whatever the slashes; on Windows whatever the case. */
export function inside(
  parent: string,
  folder: string,
  api: Pick<typeof path, "relative" | "isAbsolute" | "sep"> = path,
) {
  const fold = (value: string) => (api.sep === "\\" ? value.toLowerCase() : value)
  const relative = api.relative(fold(parent), fold(folder))
  const leaves = relative === ".." || relative.startsWith(`..${api.sep}`)
  return !!relative && !leaves && !api.isAbsolute(relative)
}

export async function setEnabled(folder: string, enabled: boolean, configDir: string) {
  const rest = (await folders(configDir)).filter((item) => !sameFolder(item, folder))
  const next = enabled ? [...rest, path.resolve(folder)] : rest
  await fs.mkdir(configDir, { recursive: true })
  // Written whole through a temporary file, so a crash never leaves half a list.
  const file = path.join(configDir, FILE)
  await fs.writeFile(`${file}.tmp`, JSON.stringify({ folders: next }, null, 2), { mode: 0o600 })
  await fs.rename(`${file}.tmp`, file)
  return enabled
}

export type Status = {
  installed: boolean
  permissions: "granted" | "missing" | "unknown"
  /** macOS only: each grant the driver reports. */
  grants?: { accessibility: boolean; screen: boolean }
}

/**
 * Whether the driver is installed and, on macOS, whether it has Accessibility and Screen Recording (it asks for them
 * under its own identity). Windows asks for neither.
 */
export async function status(input: {
  driver: string | undefined
  platform: NodeJS.Platform
  run?: (command: string, args: string[]) => Promise<string>
}): Promise<Status> {
  if (!input.driver) return { installed: false, permissions: "unknown" }
  if (input.platform !== "darwin") return { installed: true, permissions: "granted" }
  const output = await (input.run ?? execute)(input.driver, ["permissions", "status"]).catch(() => "")
  const lines = output.split("\n").map((line) => line.toLowerCase())
  const grant = (name: string) => {
    const line = lines.find((item) => item.includes(name))
    if (!line) return undefined
    return !/\b(not|missing|denied|no|false|off)\b|✗|❌/.test(line)
  }
  const accessibility = grant("accessibility")
  const screen = grant("screen")
  if (accessibility === undefined || screen === undefined) return { installed: true, permissions: "unknown" }
  return {
    installed: true,
    permissions: accessibility && screen ? "granted" : "missing",
    grants: { accessibility, screen },
  }
}

function execute(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) =>
    execFile(command, args, { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    ),
  )
}
