import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { isAllowedRequestOrigin, type CorsOptions } from "@tenon/server/cors"
import { ServerNetworkGuard } from "@/server/network-guard"

const forbidden = (message: string) =>
  HttpServerResponse.jsonUnsafe({ name: "Forbidden", data: { message } }, { status: 403 })

export const hostGuard = (hostname: string | undefined, corsOptions?: CorsOptions) =>
  hostname && ServerNetworkGuard.isLoopback(hostname)
    ? HttpRouter.middleware(
        (effect) =>
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            if (!ServerNetworkGuard.isAllowedHost(request.headers.host, hostname))
              return forbidden("Host is not allowed")
            if (!isAllowedRequestOrigin(request.headers.origin, request.headers.host, corsOptions))
              return forbidden("Origin is not allowed")
            return yield* effect
          }),
        { global: true },
      )
    : HttpRouter.middleware((effect) => effect, { global: true })
