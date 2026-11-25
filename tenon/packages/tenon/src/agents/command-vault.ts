export * as CommandVault from "./command-vault"

import { InstanceState } from "@/effect/instance-state"
import { KnowledgeVault } from "@/knowledge/vault"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { FSUtil } from "@tenon/core/fs-util"
import { Global } from "@tenon/core/global"
import { Location } from "@tenon/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@tenon/core/location-services"
import { ProjectV2 } from "@tenon/core/project"
import { AbsolutePath } from "@tenon/core/schema"
import { Effect, Option } from "effect"
import path from "node:path"

export const inFolder = <A, E, R>(directory: string, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const provided = effect.pipe(
      Effect.provideService(Global.Service, Global.make()),
      Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    )
    const locations = yield* Effect.serviceOption(LocationServiceMap.Service)
    const located = Option.isSome(locations)
      ? provided.pipe(Effect.provideService(LocationServiceMap.Service, locations.value))
      : provided.pipe(Effect.provide(locationServiceMapLayer))
    const fs = yield* Effect.serviceOption(FSUtil.Service)
    return yield* Option.isSome(fs)
      ? located.pipe(Effect.provideService(FSUtil.Service, fs.value))
      : located.pipe(Effect.provide(AppNodeBuilder.build(FSUtil.node)))
  })

export const currentWorkspace = Effect.gen(function* () {
  const context = yield* InstanceState.context
  const workspace: KnowledgeVault.Workspace = {
    directory: context.directory,
    name: path.basename(context.directory) || context.project.name || "Workspace",
    ...(context.project.id !== ProjectV2.ID.global ? { repository: context.project.id } : {}),
  }
  return workspace
})

export const withVault = <A, E, R>(run: (vault: KnowledgeVault.Vault) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const workspace = yield* currentWorkspace
    return yield* inFolder(workspace.directory, KnowledgeVault.open(workspace).pipe(Effect.flatMap(run)))
  })
