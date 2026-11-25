export * as LayerMapExample from "./layer-map.example"

import { Context, Effect, Layer, LayerMap } from "effect"
import { Npm } from "../npm"

export type RequestContext = {
  readonly directory: string
  readonly workspace: string
}

export class RequestContextRef extends Context.Service<RequestContextRef, RequestContext>()(
  "@tenon/example/RequestContextRef",
) {}

export interface ConfigServiceShape {
  readonly directory: string
  readonly workspace: string
  readonly nextUse: () => Effect.Effect<number>
  readonly which: Npm.Interface["which"]
}

export class ConfigService extends Context.Service<ConfigService, ConfigServiceShape>()(
  "@tenon/example/ConfigService",
) {}

const configServiceLayer = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const context = yield* RequestContextRef
    const npm = yield* Npm.Service

    let useCount = 0

    return ConfigService.of({
      directory: context.directory,
      workspace: context.workspace,
      nextUse: () => Effect.succeed(++useCount),
      which: npm.which,
    })
  }),
)

export class ConfigServiceMap extends LayerMap.Service<ConfigServiceMap>()("@tenon/example/ConfigServiceMap", {
  lookup: (context: RequestContext) =>
    configServiceLayer.pipe(Layer.provide(Layer.succeed(RequestContextRef, RequestContextRef.of(context)))),
  idleTimeToLive: "5 minutes",
}) {}

export const appLayer = ConfigServiceMap.layer

export const readConfig = Effect.fn("LayerMapExample.readConfig")(function* () {
  const config = yield* ConfigService

  return {
    directory: config.directory,
    workspace: config.workspace,
    useCount: yield* config.nextUse(),
  }
})

export const handleRequest = Effect.fn("LayerMapExample.handleRequest")(function* (context: RequestContext) {
  return yield* readConfig().pipe(Effect.provide(ConfigServiceMap.get(context)))
})

export const invalidateContext = (context: RequestContext) => ConfigServiceMap.invalidate(context)
