import { ServerAuth } from "@/server/auth"
import { Effect, Layer, Redacted } from "effect"
import { Base64 } from "effect/encoding"
import { HttpEffect, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiError, HttpApiMiddleware } from "effect/http-api"
import { hasPtyConnectTicketURL, PTY_CONNECT_TICKET_QUERY } from "@/server/shared/pty-ticket"
import { PtyTicket } from "@tenon/core/pty/ticket"
import { CorsConfig, isAllowedRequestOrigin } from "@tenon/server/cors"
import { isPublicUIPath } from "@/server/shared/public-ui"
import { RemoteDevice } from "@tenon/server/middleware/remote-device"
export {
  Authorization as ServerAuthorization,
  authorizationLayer as serverAuthorizationLayer,
} from "@tenon/server/middleware/authorization"

const AUTH_TOKEN_QUERY = "auth_token"
const UNAUTHORIZED = 401
const WWW_AUTHENTICATE = 'Basic realm="Secure Area"'

export class Authorization extends HttpApiMiddleware.Service<Authorization>()(
  "@tenon/ExperimentalHttpApiAuthorization",
  {
    error: HttpApiError.UnauthorizedNoContent,
  },
) {}

export class PtyConnectAuthorization extends HttpApiMiddleware.Service<PtyConnectAuthorization>()(
  "@tenon/ExperimentalHttpApiPtyConnectAuthorization",
  {
    error: HttpApiError.UnauthorizedNoContent,
  },
) {}

function emptyCredential() {
  return {
    username: "",
    password: Redacted.make(""),
  }
}

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: ServerAuth.DecodedCredentials,
  config: ServerAuth.Info,
) {
  return Effect.gen(function* () {
    if (!ServerAuth.required(config)) return yield* effect
    if (!ServerAuth.authorized(credential, config)) {
      yield* HttpEffect.appendPreResponseHandler((_request, response) =>
        Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
      )
      return yield* new HttpApiError.Unauthorized({})
    }
    return yield* effect
  })
}

function decodeCredential(input: string) {
  return Effect.fromResult(Base64.decodeString(input)).pipe(
    Effect.match({
      onFailure: emptyCredential,
      onSuccess: (header) => {
        const separator = header.indexOf(":")
        if (separator === -1) return emptyCredential()
        return {
          username: header.slice(0, separator),
          password: Redacted.make(header.slice(separator + 1)),
        }
      },
    }),
  )
}

function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
  return credentialFromURL(new URL(request.url, "http://localhost"), request)
}

function credentialFromURL(url: URL, request: HttpServerRequest.HttpServerRequest) {
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

function validateRawCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: ServerAuth.DecodedCredentials,
  config: ServerAuth.Info,
) {
  if (!ServerAuth.required(config)) return effect
  if (!ServerAuth.authorized(credential, config))
    return Effect.succeed(
      HttpServerResponse.empty({
        status: UNAUTHORIZED,
        headers: { "www-authenticate": WWW_AUTHENTICATE },
      }),
    )
  return effect
}

function deviceGate<E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  request: HttpServerRequest.HttpServerRequest,
  token: string,
  route?: { readonly method: string; readonly path: string },
) {
  return RemoteDevice.check(request, token, route).pipe(
    Effect.flatMap((verdict) => {
      if (verdict === "allowed") return effect
      if (verdict === "outside") return Effect.succeed(RemoteDevice.forbidden())
      return Effect.succeed(RemoteDevice.unauthorized())
    }),
  )
}

function streamGate<E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  request: HttpServerRequest.HttpServerRequest,
) {
  return RemoteDevice.redeemStreamTicket(request).pipe(
    Effect.flatMap((redeemed) => (redeemed ? effect : Effect.succeed(RemoteDevice.unauthorized()))),
  )
}

export const authorizationRouterMiddleware = HttpRouter.middleware()(
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config

    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, "http://localhost")
        if (isPublicUIPath(request.method, url.pathname)) return yield* effect
        const device = RemoteDevice.bearerToken(request)
        if (device !== undefined) return yield* deviceGate(effect, request, device)
        if (!ServerAuth.required(config)) return yield* effect
        return yield* credentialFromURL(url, request).pipe(
          Effect.flatMap((credential) => validateRawCredential(effect, credential, config)),
        )
      })
  }),
)

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    return Authorization.of((effect, options) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const device = RemoteDevice.bearerToken(request)
        if (device !== undefined) return yield* deviceGate(effect, request, device, options.endpoint)
        if (!ServerAuth.required(config)) return yield* effect
        if (RemoteDevice.hasStreamTicket(request, options.endpoint)) return yield* streamGate(effect, request)
        return yield* credentialFromRequest(request).pipe(
          Effect.flatMap((credential) => validateCredential(effect, credential, config)),
        )
      }),
    )
  }),
)

export const ptyConnectAuthorizationLayer = Layer.effect(
  PtyConnectAuthorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    const tickets = ServerAuth.required(config) ? yield* PtyTicket.Service : undefined
    return PtyConnectAuthorization.of((effect, options) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const device = RemoteDevice.bearerToken(request)
        if (device !== undefined) return yield* deviceGate(effect, request, device, options.endpoint)
        if (!tickets) return yield* effect
        const url = new URL(request.url, "http://localhost")
        if (hasPtyConnectTicketURL(url)) {
          const ptyID = url.pathname.split("/")[2] ?? ""
          const allowed =
            isAllowedRequestOrigin(request.headers.origin, request.headers.host, yield* CorsConfig) &&
            (yield* tickets.check({ ticket: url.searchParams.get(PTY_CONNECT_TICKET_QUERY) ?? "", ptyID }))
          if (allowed) return yield* effect
          return yield* new HttpApiError.Unauthorized({})
        }
        return yield* credentialFromURL(url, request).pipe(
          Effect.flatMap((credential) => validateCredential(effect, credential, config)),
        )
      }),
    )
  }),
)
