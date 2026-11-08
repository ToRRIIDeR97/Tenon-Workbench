import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { isAllowedRequestOrigin, type CorsOptions } from "@tenon/server/cors"
import { ServerNetworkGuard } from "@/server/network-guard"

const forbidden = (message: string) =>
  HttpServerResponse.jsonUnsafe({ name: "Forbidden", data: { message } }, { status: 403 })

/**
 * Guards a loopback-bound listener against DNS rebinding and cross-site requests: the Host header must
 * name a loopback address (or the listening hostname), and a request that carries an Origin must come
 * from an allowed one. With the Host checked, an Origin naming that same host is the server's own web
 * UI. CLI and TUI clients send no Origin. A server bound to another address keeps its existing checks.
 */
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
