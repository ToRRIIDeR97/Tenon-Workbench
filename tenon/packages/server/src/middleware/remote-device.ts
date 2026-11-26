export * as RemoteDevice from "./remote-device"

import { RemoteAccess } from "@tenon/core/remote-access"
import { RemoteAccessService } from "@tenon/core/remote-access/service"
import { Effect, Option } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"

export const STREAM_TICKET_QUERY = "ticket"
export const BEARER_CHALLENGE = 'Bearer realm="Tenon"'

export type Verdict = "allowed" | "unknown" | "outside"

type Route = { readonly method: string; readonly path: string }

export function bearerToken(request: HttpServerRequest.HttpServerRequest) {
  const match = /^Bearer(?:\s+(.*))?$/i.exec(request.headers.authorization ?? "")
  if (!match) return undefined
  return (match[1] ?? "").trim()
}

export const check = Effect.fn("RemoteDevice.check")(function* (
  request: HttpServerRequest.HttpServerRequest,
  token: string,
  route?: Route,
) {
  const device = yield* authenticate(token)
  const verdict: Verdict = !device ? "unknown" : inScope(request, route) ? "allowed" : "outside"
  return verdict
})

export const authenticate = Effect.fn("RemoteDevice.authenticate")(function* (token: string) {
  const access = yield* Effect.serviceOption(RemoteAccessService.Service)
  if (Option.isNone(access)) return undefined
  const registry = access.value.registry
  return yield* Effect.tryPromise(() => registry.authenticate(token)).pipe(Effect.orElseSucceed(() => undefined))
})

export const redeemStreamTicket = Effect.fn("RemoteDevice.redeemStreamTicket")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const access = yield* Effect.serviceOption(RemoteAccessService.Service)
  if (Option.isNone(access)) return false
  const deviceID = access.value.tickets.redeem(streamTicket(request) ?? "")
  if (!deviceID) return false
  const registry = access.value.registry
  const devices = yield* Effect.tryPromise(() => registry.devices()).pipe(Effect.orElseSucceed(() => []))
  return devices.some((device) => device.id === deviceID)
})

export function inScope(request: HttpServerRequest.HttpServerRequest, route?: Route) {
  const target = { method: request.method, path: request.url }
  return RemoteAccess.allows(target) && (route === undefined || RemoteAccess.allowsRoute(route))
}

export function streamTicket(request: HttpServerRequest.HttpServerRequest) {
  const query = request.url.indexOf("?")
  if (query === -1) return undefined
  return new URLSearchParams(request.url.slice(query + 1)).get(STREAM_TICKET_QUERY) ?? undefined
}

export function hasStreamTicket(request: HttpServerRequest.HttpServerRequest, route?: Route) {
  return (
    !!streamTicket(request) &&
    RemoteAccess.opensStream({ method: request.method, path: request.url }) &&
    (route === undefined || RemoteAccess.allowsRoute(route))
  )
}

export function forbidden() {
  return HttpServerResponse.jsonUnsafe(
    { _tag: "ForbiddenError", message: "This paired device cannot use this route" },
    { status: 403 },
  )
}

export function unauthorized() {
  return HttpServerResponse.empty({ status: 401, headers: { "www-authenticate": BEARER_CHALLENGE } })
}
