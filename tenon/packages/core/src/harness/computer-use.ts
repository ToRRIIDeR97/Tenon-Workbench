export * as HarnessComputerUse from "./computer-use"

import { execFile } from "child_process"
import fs from "fs/promises"
import path from "path"
import { Harness } from "@tenon/schema/harness"
import { which } from "../util/which"
import type { McpServer } from "./acp"

const FILE = "computer-use.json"
const NATIVE = new Set<string>([Harness.Codex, Harness.ClaudeCode])

export function serverFor(
  harness: Harness.InstanceID,
  enabled: boolean,
  driver: string | undefined,
): McpServer | undefined {
  if (!enabled || !driver || NATIVE.has(harness)) return undefined
  return { name: "computer", command: driver, args: ["mcp"], env: [] }
}

export const findDriver = () => which("cua-driver") ?? undefined

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

export async function enabledFor(folder: string, configDir: string) {
  return (await folders(configDir)).some((item) => sameFolder(item, folder) || inside(item, folder))
}

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
  const file = path.join(configDir, FILE)
  await fs.writeFile(`${file}.tmp`, JSON.stringify({ folders: next }, null, 2), { mode: 0o600 })
  await fs.rename(`${file}.tmp`, file)
  return enabled
}

export type Status = {
  installed: boolean
  permissions: "granted" | "missing" | "unknown"
  grants?: { accessibility: boolean; screen: boolean }
}

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
