import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"

export const Device = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tokenHash: Schema.String,
  createdAt: Schema.Number,
  lastSeenAt: Schema.NullOr(Schema.Number),
})
export type Device = typeof Device.Type

const Contents = Schema.Struct({ version: Schema.Literal(1), devices: Schema.Array(Device) })
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Contents))

export async function readDevices(file: string, now: number): Promise<Array<Device>> {
  const text = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (text === undefined) return []
  const parsed = decode(text)
  if (Option.isSome(parsed)) return [...parsed.value.devices]
  await fs.rename(file, `${file}.broken-${now}`)
  return []
}

export async function writeDevices(file: string, devices: ReadonlyArray<Device>) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`
  await fs.writeFile(temp, JSON.stringify({ version: 1, devices }, null, 2), { mode: 0o600 })
  if (process.platform === "win32") await restrictToCurrentUser(temp)
  await fs.rename(temp, file).catch(async (error: unknown) => {
    await fs.rm(temp, { force: true })
    throw error
  })
}

export function restrictToCurrentUser(file: string) {
  const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username
  const icacls = path.win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe")
  return new Promise<boolean>((resolve) =>
    execFile(icacls, [file, "/inheritance:r", "/grant:r", `${user}:F`], { windowsHide: true }, (error) =>
      resolve(!error),
    ),
  )
}
