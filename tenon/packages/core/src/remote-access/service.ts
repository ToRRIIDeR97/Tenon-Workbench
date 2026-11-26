export * as RemoteAccessService from "./service"

import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { Global } from "../global"
import { limiter, PAIR_ATTEMPTS_PER_MINUTE, streamTickets, type Limiter, type StreamTickets } from "./limits"
import { registry, type Registry } from "./registry"

export const FILE_NAME = "remote-devices.json"

export interface Interface {
  readonly registry: Registry
  readonly tickets: StreamTickets
  readonly pairing: Limiter
}

export class Service extends Context.Service<Service, Interface>()("@tenon/RemoteAccess") {}

export function make(input: { file: string; now?: () => number }) {
  return Service.of({
    registry: registry(input),
    tickets: streamTickets({ now: input.now }),
    pairing: limiter({ limit: PAIR_ATTEMPTS_PER_MINUTE, window: 60_000, now: input.now }),
  })
}

export const layerWith = (input: { file: string; now?: () => number }) =>
  Layer.effect(
    Service,
    Effect.sync(() => make(input)),
  )

const layer = Layer.effect(
  Service,
  Effect.sync(() => make({ file: path.join(Global.make().data, FILE_NAME) })),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
