export * as RoutinesScheduler from "./routines-scheduler"

import { KnowledgeVault } from "@/knowledge/vault"
import { InstanceStore } from "@/project/instance-store"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { Global } from "@tenon/core/global"
import { LocationServiceMap } from "@tenon/core/location-services"
import { Effect, Layer, Schedule } from "effect"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { CommandThreads } from "./command-threads"
import { Routines } from "./routines"

/**
 * Runs due routines at server start and then every minute, for each workspace that has a vault folder
 * on this machine (the vault's machine map in app data). Missed times catch up once (Routines.runDue).
 * Only a listening server starts it, never the in-process test routes.
 */

/** Workspace directories with a vault folder under the current root, from `vault-machine.json`. */
const workspaces = Effect.promise(async () => {
  const source = await readFile(path.join(Global.make().data, "vault-machine.json"), "utf8").catch(() => undefined)
  if (!source) return [] as string[]
  try {
    const machine = JSON.parse(source) as { roots?: Record<string, Record<string, string>> }
    const directories = Object.keys(machine.roots?.[KnowledgeVault.rootFor(process.env, Global.make().home)] ?? {})
    const present = await Promise.all(
      directories.map((directory) =>
        stat(directory)
          .then((info) => info.isDirectory())
          .catch(() => false),
      ),
    )
    return directories.filter((_, index) => present[index])
  } catch {
    return [] as string[]
  }
})

/** `provider/model` from a routine's `model` property. */
export function modelChoice(value: string | undefined): CommandThreads.ModelChoice | undefined {
  const index = value?.indexOf("/") ?? -1
  if (!value || index <= 0 || index === value.length - 1) return undefined
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const sessions = yield* Session.Service
    const prompts = yield* SessionPrompt.Service
    const locations = yield* LocationServiceMap.Service
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(InstanceStore.Service, store),
        Effect.provideService(Session.Service, sessions),
        Effect.provideService(SessionPrompt.Service, prompts),
        Effect.provideService(LocationServiceMap.Service, locations),
      )
    const run: Routines.Run<unknown> = (routine) =>
      provide(
        CommandThreads.start({ prompt: routine.prompt, title: routine.name, model: modelChoice(routine.model) }).pipe(
          Effect.flatMap((started) => started.reply.pipe(Effect.map((text) => ({ threadId: started.threadId, text })))),
        ),
      )
    const tick = Effect.gen(function* () {
      for (const directory of yield* workspaces) {
        yield* store
          .provide({ directory }, provide(Routines.runDue({ now: new Date(), run })))
          .pipe(Effect.catchCause((cause) => Effect.logWarning("Routines check failed", { cause })))
      }
    })
    yield* tick.pipe(
      Effect.catchCause((cause) => Effect.logWarning("Routines scheduler tick failed", { cause })),
      Effect.repeat(Schedule.spaced("1 minute")),
      Effect.forkScoped,
    )
  }),
)
