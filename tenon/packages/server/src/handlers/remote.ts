import { RemoteAccessService } from "@tenon/core/remote-access/service"
import { ForbiddenError } from "@tenon/protocol/errors"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { RemoteDevice } from "../middleware/remote-device"

export const RemoteHandler = HttpApiBuilder.group(Api, "server.remote", (handlers) =>
  handlers
    .handle("remote.pairingCode", () =>
      Effect.gen(function* () {
        const access = yield* RemoteAccessService.Service
        return access.registry.pairingCode()
      }),
    )
    .handle("remote.devices", () =>
      Effect.gen(function* () {
        const access = yield* RemoteAccessService.Service
        return { devices: yield* Effect.promise(() => access.registry.devices()) }
      }),
    )
    .handle("remote.revoke", (ctx) =>
      Effect.gen(function* () {
        const access = yield* RemoteAccessService.Service
        return { removed: yield* Effect.promise(() => access.registry.revoke(ctx.params.id)) }
      }),
    )
    .handle("remote.streamTicket", () =>
      Effect.gen(function* () {
        const access = yield* RemoteAccessService.Service
        const request = yield* HttpServerRequest.HttpServerRequest
        const device = yield* RemoteDevice.authenticate(RemoteDevice.bearerToken(request) ?? "")
        if (!device) return yield* new ForbiddenError({ message: "Only a paired device asks for a stream ticket" })
        return access.tickets.issue(device.id)
      }),
    ),
)
