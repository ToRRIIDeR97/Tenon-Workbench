import { rename } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { message, readText, writeAtomic } from "./fsutil"

export type LocalState = {
  syncFile?: string
  deviceName?: string
  applied: Record<string, string>
  appliedSkills: Record<string, string>
  writtenSkills: string[]
  lastFileHash?: string
}

export const emptyState = (): LocalState => ({ applied: {}, appliedSkills: {}, writtenSkills: [] })

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === "string")

function parseState(text: string): LocalState {
  const value = JSON.parse(text) as Record<string, unknown>
  const optional = (key: string) => {
    const item = value[key]
    if (item !== undefined && item !== null && typeof item !== "string") throw new Error(`${key} is malformed`)
    return item ?? undefined
  }
  const record = (key: string) => {
    const item = value[key] ?? {}
    if (!isStringRecord(item)) throw new Error(`${key} is malformed`)
    return item
  }
  const written = value.writtenSkills ?? []
  if (!Array.isArray(written) || !written.every((item) => typeof item === "string"))
    throw new Error("writtenSkills is malformed")
  return {
    syncFile: optional("syncFile"),
    deviceName: optional("deviceName"),
    applied: record("applied"),
    appliedSkills: record("appliedSkills"),
    writtenSkills: written,
    lastFileHash: optional("lastFileHash"),
  }
}

export async function loadState(file: string): Promise<{ state: LocalState; warning?: string }> {
  const parsed = await readText(file)
    .then((text) => ({ state: text === undefined ? emptyState() : parseState(text) }))
    .catch((error: unknown) => ({ error: message(error) }))
  if ("state" in parsed) return { state: parsed.state }
  const aside = `${file}.unreadable-${Math.floor(Date.now() / 1000)}`
  const moved = await rename(file, aside).then(
    () => undefined,
    (error: unknown) => message(error),
  )
  return {
    state: emptyState(),
    warning:
      moved === undefined
        ? `Harness sync settings could not be read and were reset. The old copy is ${path.basename(aside)}.`
        : `Harness sync settings could not be read (${parsed.error}) or moved aside (${moved}) and were reset.`,
  }
}

export const saveState = (file: string, state: LocalState) => writeAtomic(file, JSON.stringify(state, null, 2))

export const deviceName = (state: LocalState) => state.deviceName ?? (os.hostname().trim() || "This computer")
