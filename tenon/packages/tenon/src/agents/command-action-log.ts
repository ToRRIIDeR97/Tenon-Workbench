export * as CommandActionLog from "./command-action-log"

import { HarnessAppTools } from "@tenon/core/harness/app-tools"
import { Effect, Option, Schema, Semaphore } from "effect"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { CommandActions } from "./command-actions"
import { CommandMemory } from "./command-memory"

const lock = Semaphore.makeUnsafe(1)
const decodeLog = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(CommandActions.Action)))

const file = () => path.join(CommandMemory.root(), HarnessAppTools.COMMAND_CENTRE_FOLDER, "actions.json")

const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

const load = async () => {
  const source = await readFile(file(), "utf8").catch((error: unknown) =>
    missing(error) ? undefined : Promise.reject(error),
  )
  if (source === undefined) return { log: [] as ReadonlyArray<CommandActions.Action>, corrupt: false }
  const decoded = decodeLog(source)
  if (Option.isNone(decoded)) return { log: [] as ReadonlyArray<CommandActions.Action>, corrupt: true }
  return { log: decoded.value, corrupt: false }
}

export const read = Effect.promise(() => load().then((loaded) => loaded.log))

export const readSince = (from: number) => read.pipe(Effect.map((log) => CommandActions.since(log, from)))

export const record = (action: CommandActions.Action) =>
  lock.withPermits(1)(
    Effect.promise(async () => {
      const target = file()
      const loaded = await load()
      if (loaded.corrupt) await rename(target, `${target}.corrupt-${Date.now()}`)
      const next = CommandActions.append(loaded.log, action)
      await mkdir(path.dirname(target), { recursive: true })
      const temp = `${target}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify(next, null, 2) + "\n")
      await rename(temp, target)
    }),
  )
