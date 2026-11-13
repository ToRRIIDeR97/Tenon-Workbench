export * as CommandActionLog from "./command-action-log"

import { HarnessAppTools } from "@tenon/core/harness/app-tools"
import { Effect, Option, Schema, Semaphore } from "effect"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { CommandActions } from "./command-actions"
import { CommandMemory } from "./command-memory"

/**
 * The Command Centre's action log, kept as `<vault root>/.command-centre/actions.json` next to its memory
 * files, so it survives a restart and follows the vault. Writes are one at a time and replace the file whole.
 * Only a missing file is an empty log. A file that cannot be read for another reason is left alone and the
 * write fails (the caller warns), so a passing error never wipes the log. A file that does not parse, or holds
 * an invalid entry, is renamed to `actions.json.corrupt-<time>` before a new log starts, so nothing is lost.
 */

const lock = Semaphore.makeUnsafe(1)
const decodeLog = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(CommandActions.Action)))

const file = () => path.join(CommandMemory.root(), HarnessAppTools.COMMAND_CENTRE_FOLDER, "actions.json")

const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

/** The stored log; `corrupt` says the file exists but is not a valid log. A read error other than "missing" throws. */
const load = async () => {
  const source = await readFile(file(), "utf8").catch((error: unknown) =>
    missing(error) ? undefined : Promise.reject(error),
  )
  if (source === undefined) return { log: [] as ReadonlyArray<CommandActions.Action>, corrupt: false }
  const decoded = decodeLog(source)
  if (Option.isNone(decoded)) return { log: [] as ReadonlyArray<CommandActions.Action>, corrupt: true }
  return { log: decoded.value, corrupt: false }
}

/** Every logged action, newest first. A file that is not a valid log reads as empty and is left in place. */
export const read = Effect.promise(() => load().then((loaded) => loaded.log))

/** Today's (or any later) actions: those at or after `from`, newest first. */
export const readSince = (from: number) => read.pipe(Effect.map((log) => CommandActions.since(log, from)))

/** Adds `action` to the log. Fails, without touching the file, when the file cannot be read. */
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
