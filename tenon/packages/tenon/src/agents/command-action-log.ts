export * as CommandActionLog from "./command-action-log"

import { HarnessAppTools } from "@tenon/core/harness/app-tools"
import { Effect, Option, Schema, Semaphore } from "effect"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { CommandActions } from "./command-actions"
import { CommandMemory } from "./command-memory"

/**
 * The Command Centre's action log, kept as `<vault root>/.command-centre/actions.json` next to its memory
 * files, so it survives a restart and follows the vault. A file that cannot be read counts as an empty log
 * and the next action replaces it. Writes are one at a time and replace the file whole.
 */

const lock = Semaphore.makeUnsafe(1)
const decodeLog = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(CommandActions.Action)))

const file = () => path.join(CommandMemory.root(), HarnessAppTools.COMMAND_CENTRE_FOLDER, "actions.json")

const load = () =>
  readFile(file(), "utf8").then(
    (source) => Option.getOrElse(decodeLog(source), (): ReadonlyArray<CommandActions.Action> => []),
    (): ReadonlyArray<CommandActions.Action> => [],
  )

/** Every logged action, newest first. */
export const read = Effect.promise(() => load())

/** Today's (or any later) actions: those at or after `from`, newest first. */
export const readSince = (from: number) => read.pipe(Effect.map((log) => CommandActions.since(log, from)))

/** Adds `action` to the log. */
export const record = (action: CommandActions.Action) =>
  lock.withPermits(1)(
    Effect.promise(async () => {
      const target = file()
      const next = CommandActions.append(await load(), action)
      await mkdir(path.dirname(target), { recursive: true })
      const temp = `${target}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify(next, null, 2) + "\n")
      await rename(temp, target)
    }),
  )
