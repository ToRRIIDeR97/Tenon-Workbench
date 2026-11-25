export * as PtyTicket from "./ticket"

import { WorkspaceV2 } from "../workspace"
import { PtyTicket } from "@tenon/schema/pty-ticket"
import { PtyID } from "./schema"
import { Cache, Context, Duration, Effect, Layer, Option } from "effect"
import { makeGlobalNode } from "../effect/app-node"

const DEFAULT_TTL = Duration.seconds(60)
const CAPACITY = 10_000

export const ConnectToken = PtyTicket.ConnectToken

export type Scope = {
  readonly ptyID: PtyID
  readonly directory?: string
  readonly workspaceID?: WorkspaceV2.ID
}

export interface Interface {
  issue(input: Scope): Effect.Effect<typeof ConnectToken.Type>
  consume(input: Scope & { readonly ticket: string }): Effect.Effect<boolean>
  check(input: { readonly ticket: string; readonly ptyID: string }): Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@tenon/PtyTicket") {}

function matches(record: Scope, input: Scope) {
  return (
    record.ptyID === input.ptyID && record.directory === input.directory && record.workspaceID === input.workspaceID
  )
}

const noLookup = () => Effect.die("PtyTicket cache must be used via set/invalidateWhen, never get")

export const make = (ttl: Duration.Input = DEFAULT_TTL) =>
  Effect.gen(function* () {
    const cache = yield* Cache.make<string, Scope>({ capacity: CAPACITY, lookup: noLookup, timeToLive: ttl })
    const expiresIn = Math.max(1, Math.round(Duration.toSeconds(Duration.fromInputUnsafe(ttl))))
    return Service.of({
      issue: Effect.fn("PtyTicket.issue")(function* (input) {
        const ticket = crypto.randomUUID()
        yield* Cache.set(cache, ticket, input)
        return { ticket, expires_in: expiresIn }
      }),
      consume: Effect.fn("PtyTicket.consume")(function* (input) {
        return yield* Cache.invalidateWhen(cache, input.ticket, (stored) => matches(stored, input))
      }),
      check: Effect.fn("PtyTicket.check")(function* (input) {
        const stored = yield* Cache.getOption(cache, input.ticket)
        return Option.isSome(stored) && stored.value.ptyID === input.ptyID
      }),
    })
  })

const layer = Layer.effect(Service, make())

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })
