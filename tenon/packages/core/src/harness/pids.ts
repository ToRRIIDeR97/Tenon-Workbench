export * as HarnessPids from "./pids"

import { execFile } from "child_process"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"

let ledger: string | undefined
let reaped = false

export interface Entry {
  readonly pid: number
  readonly command: string
  readonly owner?: number
}

export const configure = (directory: string) =>
  Effect.promise(() => fs.mkdir(directory, { recursive: true })).pipe(
    Effect.andThen(Effect.sync(() => (ledger = directory))),
    Effect.ignore,
  )

export const track = (pid: number | undefined, command: string) => {
  const directory = ledger
  if (!directory || !pid) return Effect.void
  const file = path.join(directory, `${pid}.json`)
  return Effect.acquireRelease(
    Effect.promise(() =>
      fs.writeFile(file, JSON.stringify({ pid, command, owner: process.pid } satisfies Entry)).catch(() => undefined),
    ),
    () => Effect.promise(() => fs.rm(file, { force: true }).catch(() => undefined)),
  )
}

export async function reap(
  entries: ReadonlyArray<Entry>,
  running: (pid: number, command: string) => Promise<boolean>,
  kill: (pid: number) => void,
) {
  const ended: number[] = []
  for (const entry of entries) {
    if (!(await running(entry.pid, entry.command).catch(() => false))) continue
    kill(entry.pid)
    ended.push(entry.pid)
  }
  return ended
}

export const reapLedger = Effect.promise(async () => {
  const directory = ledger
  if (!directory || reaped) return []
  reaped = true
  const names = await fs.readdir(directory).catch(() => [] as string[])
  const entries = (
    await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) =>
          fs
            .readFile(path.join(directory, name), "utf8")
            .then((text) => JSON.parse(text) as Entry)
            .catch(() => undefined),
        ),
    )
  )
    .filter((entry): entry is Entry => !!entry && Number.isInteger(entry.pid) && typeof entry.command === "string")
    .filter((entry) => entry.owner !== process.pid)
  const windows = process.platform === "win32"
  const ended = await reap(entries, windows ? commandOfWindows : commandOf, windows ? killTree : killGroup)
  await Promise.all(
    entries.map((entry) => fs.rm(path.join(directory, `${entry.pid}.json`), { force: true }).catch(() => undefined)),
  )
  return ended
})

export function runsCommand(line: string, command: string, platform: NodeJS.Platform = process.platform) {
  const name = (platform === "win32" ? path.win32 : path.posix).basename(command).toLowerCase()
  return name.length > 0 && line.toLowerCase().includes(name)
}

function commandOf(pid: number, command: string) {
  return new Promise<boolean>((resolve) =>
    execFile("ps", ["-p", String(pid), "-o", "command="], { timeout: 2_000 }, (error, stdout) =>
      resolve(!error && runsCommand(stdout, command)),
    ),
  )
}

function commandOfWindows(pid: number, command: string) {
  const query = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`
  return new Promise<boolean>((resolve) =>
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", query],
      { timeout: 5_000, windowsHide: true },
      (error, stdout) => resolve(!error && runsCommand(stdout, command, "win32")),
    ),
  )
}

function killGroup(pid: number) {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM")
      return
    } catch {}
  }
}

function killTree(pid: number) {
  execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { timeout: 5_000, windowsHide: true }, () => undefined)
}
