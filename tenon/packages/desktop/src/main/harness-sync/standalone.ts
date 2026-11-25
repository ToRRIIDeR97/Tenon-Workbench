import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { loadState, saveState } from "./state"

const IDENTIFIER = "app.harnesssync.desktop"
const WINDOWS_IMAGE = "harness-sync.exe"

export type StandalonePaths = { dataDir: string; installs: string[]; platform: NodeJS.Platform }

export function standalonePaths(home: string, env: NodeJS.ProcessEnv, platform = process.platform): StandalonePaths {
  if (platform === "win32") {
    const join = (...parts: string[]) => path.win32.join(...parts)
    const local =
      env.LOCALAPPDATA && path.win32.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : join(home, "AppData", "Local")
    const programs = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(
      (dir): dir is string => !!dir && path.win32.isAbsolute(dir),
    )
    return {
      dataDir: join(local, IDENTIFIER),
      installs: [local, ...programs].map((dir) => join(dir, "Harness Sync", WINDOWS_IMAGE)),
      platform,
    }
  }
  const join = (...parts: string[]) => path.posix.join(...parts)
  if (platform === "darwin")
    return {
      dataDir: join(home, "Library", "Application Support", IDENTIFIER),
      installs: ["/Applications", join(home, "Applications")].map((dir) => join(dir, "Harness Sync.app")),
      platform,
    }
  const data =
    env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, ".local", "share")
  return { dataDir: join(data, IDENTIFIER), installs: ["/usr/bin/harness-sync"], platform }
}

export const standaloneInstalled = (paths: StandalonePaths) =>
  [paths.dataDir, ...paths.installs].some((target) => existsSync(target))

const run = (command: string, args: string[]) =>
  new Promise<{ ok: boolean; stdout: string }>((resolve) =>
    execFile(command, args, { timeout: 5_000, windowsHide: true }, (error, stdout) => resolve({ ok: !error, stdout })),
  )

export async function standaloneRunning(platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") {
    const result = await run("tasklist", ["/FI", `IMAGENAME eq ${WINDOWS_IMAGE}`, "/NH", "/FO", "CSV"])
    return result.ok && result.stdout.toLowerCase().includes(`"${WINDOWS_IMAGE}"`)
  }
  const args = platform === "darwin" ? ["-f", "Harness Sync.app/Contents/MacOS/"] : ["-x", "harness-sync"]
  return (await run("pgrep", args)).ok
}

export const standaloneDeviceName = (env: NodeJS.ProcessEnv) =>
  [env.COMPUTERNAME, env.HOSTNAME].map((name) => name?.trim()).find((name) => !!name) ?? "This computer"

export async function adoptState(ownDir: string, appDir: string) {
  const appFile = path.join(appDir, "state.json")
  const app = (await loadState(appFile)).state
  if (app.syncFile) return
  const own = (await loadState(path.join(ownDir, "state.json"))).state
  if (!own.syncFile) return
  await saveState(appFile, { ...own, deviceName: app.deviceName ?? own.deviceName })
}
