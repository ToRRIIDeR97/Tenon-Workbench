import { RemoteAccess } from "@tenon/core/remote-access"
import { RemoteAccessService } from "@tenon/core/remote-access/service"
import { Effect, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { PairingInvalidName, PairingRateLimited, PairingRefused, RemotePairApi } from "../groups/remote"

export const remotePairHandlers = HttpApiBuilder.group(RemotePairApi, "remotePair", (handlers) =>
  handlers.handle("pair", (ctx) =>
    Effect.gen(function* () {
      const access = yield* RemoteAccessService.Service
      const request = yield* HttpServerRequest.HttpServerRequest
      const address = Option.getOrElse(request.remoteAddress, () => "unknown")
      if (!access.pairing.take(address))
        return yield* new PairingRateLimited({ message: "Too many pairing attempts; wait a minute" })
      return yield* Effect.tryPromise({
        try: () => access.registry.pair(ctx.payload),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          error instanceof RemoteAccess.PairError ? Effect.fail(refusal(error)) : Effect.die(error),
        ),
      )
    }),
  ),
)

function refusal(error: RemoteAccess.PairError) {
  if (error.code === "invalid_name") return new PairingInvalidName({ code: "invalid_name", message: error.message })
  return new PairingRefused({ code: error.code, message: error.message })
}
