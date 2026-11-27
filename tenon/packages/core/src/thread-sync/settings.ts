import { randomBytes, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import timers from "node:timers/promises"
import { Option, Schema } from "effect"
import { DRIVE_FOLDER } from "./drive"

const MACHINE_NAME_MAX = 64
const DRIVE_FOLDER_MAX = 100

export const Settings = Schema.Struct({
  enabled: Schema.Boolean,
  driveFolder: Schema.optional(Schema.String),
  machine: Schema.Struct({ id: Schema.String, name: Schema.String }),
  folders: Schema.Record(Schema.String, Schema.String),
})
export type Settings = typeof Settings.Type

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(Settings))

export async function loadSettings(file: string, hostname: string): Promise<Settings> {
  const text = await fs
    .readFile(file, "utf8")
    .catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? undefined : ""))
  const parsed = text === undefined ? undefined : Option.getOrUndefined(decodeSettings(text))
  if (parsed && isMachineName(parsed.machine.name) && parsed.machine.id !== "") return parsed
  if (text !== undefined) await fs.rename(file, `${file}.broken-${Date.now()}`).catch(() => undefined)
  const fresh = defaults(hostname)
  await saveSettings(file, fresh).catch(() => undefined)
  return fresh
}

export async function saveSettings(file: string, settings: Settings) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 })
  await replace(temporary, file, 0)
}

export function isDriveFolder(name: string) {
  const length = Array.from(name).length
  return name === name.trim() && length >= 1 && length <= DRIVE_FOLDER_MAX && !/\p{Cc}/u.test(name)
}

export function driveFolderOf(settings: Settings) {
  return settings.driveFolder ?? DRIVE_FOLDER
}

export function isMachineName(name: string) {
  const length = Array.from(name).length
  return name === name.trim() && length >= 1 && length <= MACHINE_NAME_MAX
}

export function folderOf(settings: Settings, sessionID: string) {
  return Object.hasOwn(settings.folders, sessionID) ? settings.folders[sessionID] : null
}

export function withFolder(settings: Settings, sessionID: string, directory: string): Settings {
  return {
    ...settings,
    folders: Object.fromEntries([
      ...Object.entries(settings.folders).filter(([id]) => id !== sessionID),
      [sessionID, directory],
    ]),
  }
}

function defaults(hostname: string): Settings {
  const host = hostname.trim() || "computer"
  return {
    enabled: false,
    machine: {
      id: `${host}-${randomBytes(3).toString("hex")}`,
      name: Array.from(host).slice(0, MACHINE_NAME_MAX).join(""),
    },
    folders: {},
  }
}

async function replace(from: string, to: string, attempt: number): Promise<void> {
  const failure = await fs.rename(from, to).then(
    () => undefined,
    (error: NodeJS.ErrnoException) => error,
  )
  if (!failure) return
  if (attempt < 20 && (failure.code === "EPERM" || failure.code === "EBUSY" || failure.code === "EACCES")) {
    await timers.setTimeout(10)
    return replace(from, to, attempt + 1)
  }
  await fs.rm(from, { force: true })
  throw failure
}
