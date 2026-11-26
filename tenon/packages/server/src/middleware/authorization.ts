import { ServerAuth } from "../auth"
import { UnauthorizedError } from "@tenon/protocol/errors"
import { Authorization } from "@tenon/protocol/middleware/authorization"
export { Authorization } from "@tenon/protocol/middleware/authorization"
import { hasPtyConnectTicketURL } from "@tenon/protocol/groups/pty"
import { PtyTicket } from "@tenon/core/pty/ticket"
import { CorsConfig, isAllowedRequestOrigin } from "../cors"
import { RemoteDevice } from "./remote-device"
import { Effect, Layer, Redacted } from "effect"
import { Base64 } from "effect/encoding"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/http"

const AUTH_TOKEN_QUERY = "auth_token"
const WWW_AUTHENTICATE = 'Basic realm="Secure Area"'

function emptyCredential() {
  return { username: "", password: Redacted.make("") }
}

function decodeCredential(input: string) {
  return Effect.fromResult(Base64.decodeString(input)).pipe(
    Effect.match({
      onFailure: emptyCredential,
      onSuccess: (header) => {
        const separator = header.indexOf(":")
        if (separator === -1) return emptyCredential()
        return { username: header.slice(0, separator), password: Redacted.make(header.slice(separator + 1)) }
      },
    }),
  )
}

function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
  const url = new URL(request.url, "http://localhost")
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    const required = ServerAuth.required(config)
    const tickets = required ? yield* PtyTicket.Service : undefined
    return Authorization.of((effect, options) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const device = RemoteDevice.bearerToken(request)
        if (device !== undefined) {
          const verdict = yield* RemoteDevice.check(request, device, options.endpoint)
          if (verdict === "allowed") return yield* effect
          if (verdict === "outside") return RemoteDevice.forbidden()
          yield* HttpEffect.appendPreResponseHandler((_request, response) =>
            Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", RemoteDevice.BEARER_CHALLENGE)),
          )
          return yield* new UnauthorizedError({ message: "Authentication required" })
        }
        if (!required || !tickets) return yield* effect
        const url = new URL(request.url, "http://localhost")
        if (hasPtyConnectTicketURL(url)) {
          const ptyID = url.pathname.split("/")[3] ?? ""
          const allowed =
            isAllowedRequestOrigin(request.headers.origin, request.headers.host, yield* CorsConfig) &&
            (yield* tickets.check({ ticket: url.searchParams.get("ticket") ?? "", ptyID }))
          if (allowed) return yield* effect
          return yield* new UnauthorizedError({ message: "Authentication required" })
        }
        if (RemoteDevice.hasStreamTicket(request, options.endpoint)) {
          if (yield* RemoteDevice.redeemStreamTicket(request)) return yield* effect
          return yield* new UnauthorizedError({ message: "Authentication required" })
        }
        const credential = yield* credentialFromRequest(request)
        if (ServerAuth.authorized(credential, config)) return yield* effect
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
        )
        return yield* new UnauthorizedError({ message: "Authentication required" })
      }),
    )
  }),
)
