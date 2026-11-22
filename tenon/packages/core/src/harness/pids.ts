export * as HarnessPids from "./pids"

import { execFile } from "child_process"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"

/**
 * A ledger of running harness processes, one file per PID in the app's state folder. Harnesses are spawned in their
 * own process group (detached) so their whole tree can be stopped; when the app's server dies without running its
 * finalizers, those processes outlive it. The next start ends the ones still running the recorded command.
 */
let ledger: string | undefined
// Every location layer configures the ledger, but only the first reap of a server run may end anything.
let reaped = false

export interface Entry {
  readonly pid: number
  readonly command: string
  /** The app server process that spawned it; entries from the running server are never reaped. */
  readonly owner?: number
}

/** Points the ledger at a folder; until then recording is a no-op. */
export const configure = (directory: string) =>
  Effect.promise(() => fs.mkdir(directory, { recursive: true })).pipe(
    Effect.andThen(Effect.sync(() => (ledger = directory))),
    Effect.ignore,
  )

/** Records a spawned harness until the surrounding scope closes. */
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

/** Ends each recorded process that is still running its recorded command; returns the PIDs it ended. */
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

/**
 * Reaps the ledger left by a previous run and clears it. Posix signals the recorded PID's process group; Windows
 * checks the PID with PowerShell and ends its tree with `taskkill /T`. Both act only while the PID still runs its
 * recorded command, since a PID can be reused by an unrelated process.
 */
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
    // This server's own harnesses are live; only those left by an earlier run are candidates.
    .filter((entry) => entry.owner !== process.pid)
  const windows = process.platform === "win32"
  const ended = await reap(entries, windows ? commandOfWindows : commandOf, windows ? killTree : killGroup)
  await Promise.all(
    entries.map((entry) => fs.rm(path.join(directory, `${entry.pid}.json`), { force: true }).catch(() => undefined)),
  )
  return ended
})

/** Whether a process line names the recorded command; a PID is acted on only while it does. */
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

// Windows has no `ps`; its PowerShell reports the same command line for a process the user owns.
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
  // The PID leads its own process group, so the negative PID stops the harness and everything it started.
  // A process that exited in the meantime throws ESRCH; there is nothing left to end then.
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM")
      return
    } catch {}
  }
}

// Harnesses are not detached on Windows, so their children (the agent's own server, the shells and dev servers the
// agent started) only go with `taskkill /T`. A process that exited in the meantime makes taskkill exit non-zero.
function killTree(pid: number) {
  execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { timeout: 5_000, windowsHide: true }, () => undefined)
}
