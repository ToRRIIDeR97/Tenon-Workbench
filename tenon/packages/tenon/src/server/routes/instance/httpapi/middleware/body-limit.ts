import { ByteSize, Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

export const MAX_BODY_BYTES = 32 * 1024 * 1024

export const bodyLimitLayer = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (Number(request.headers["content-length"]) > MAX_BODY_BYTES) return HttpServerResponse.empty({ status: 413 })
      return yield* effect.pipe(Effect.provideService(HttpServerRequest.MaxBodySize, ByteSize.bytes(MAX_BODY_BYTES)))
    }),
  { global: true },
)
