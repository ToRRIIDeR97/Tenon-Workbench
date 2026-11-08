import * as InstanceState from "@/effect/instance-state"
import { registerDisposer } from "@/effect/instance-registry"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { Plugin } from "@/plugin"
import { Pty } from "@tenon/core/pty"
import { PtyProtocol } from "@tenon/core/pty/protocol"
import { PtyID } from "@tenon/core/pty/schema"
import { PtyTicket } from "@tenon/core/pty/ticket"
import { LocationServiceMap, locationServiceMapLayer } from "@tenon/core/location-services"
import { Location } from "@tenon/core/location"
import { AbsolutePath } from "@tenon/core/schema"
import { Shell } from "@tenon/core/shell"
import { CorsConfig, isAllowedRequestOrigin, type CorsOptions } from "@tenon/server/cors"
import {
  PTY_CONNECT_TICKET_QUERY,
  PTY_CONNECT_TOKEN_HEADER,
  PTY_CONNECT_TOKEN_HEADER_VALUE,
  PTY_CONNECT_TOKEN_TENON_HEADER,
} from "@/server/shared/pty-ticket"
import { Effect, Layer, Option, Queue, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import * as Socket from "effect/socket/Socket"
import { InstanceHttpApi } from "../api"
import * as ApiError from "../errors"
import { CursorQuery, PtyConnectApi } from "../groups/pty"
import { WebSocketTracker } from "../websocket-tracker"
import { runRaw } from "@tenon/core/util/socket"

function validOrigin(request: HttpServerRequest.HttpServerRequest, opts: CorsOptions | undefined) {
  return isAllowedRequestOrigin(request.headers.origin, request.headers.host, opts)
}

const ticketScope = Effect.gen(function* () {
  const instance = yield* InstanceRef
  const workspaceID = yield* WorkspaceRef
  return { directory: instance?.directory, workspaceID }
})

// Legacy surface compatibility: before exited-session retention, sessions vanished the moment
// their process exited. These routes preserve that observable behavior — exited sessions are
// invisible here — while the canonical /api/pty surface exposes them until removal.
export const ptyHandlers = HttpApiBuilder.group(InstanceHttpApi, "pty", (handlers) =>
  Effect.gen(function* () {
    const tickets = yield* PtyTicket.Service
    const cors = yield* CorsConfig
    const plugin = yield* Plugin.Service
    const locations = yield* LocationServiceMap.Service
    const unregister = registerDisposer((directory) =>
      Effect.runPromise(locations.invalidate(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    )
    yield* Effect.addFinalizer(() => Effect.sync(unregister))

    const pty = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
        ),
      )
    })

    const shells = Effect.fn("PtyHttpApi.shells")(function* () {
      return yield* Effect.promise(() => Shell.list())
    })

    const list = Effect.fn("PtyHttpApi.list")(function* () {
      const sessions = yield* pty(Pty.Service.use((service) => service.list()))
      return sessions.filter((info) => info.status === "running")
    })

    const create = Effect.fn("PtyHttpApi.create")(function* (ctx: { payload: typeof Pty.CreateInput.Type }) {
      const cwd = ctx.payload.cwd || (yield* InstanceState.context).directory
      const shell = yield* plugin.trigger("shell.env", { cwd }, { env: {} as Record<string, string> })
      return yield* pty(
        Pty.Service.use((service) =>
          service.create({
            ...ctx.payload,
            args: ctx.payload.args ? [...ctx.payload.args] : undefined,
            cwd,
            env: { ...ctx.payload.env, ...shell.env },
          }),
        ),
      ).pipe(
        Effect.catchTag("Pty.SpawnError", (error) =>
          Effect.fail(new ApiError.InvalidRequestError({ message: error.message, field: error.field })),
        ),
      )
    })

    const get = Effect.fn("PtyHttpApi.get")(function* (ctx: { params: { ptyID: PtyID } }) {
      return yield* pty(Pty.Service.use((service) => service.get(ctx.params.ptyID))).pipe(
        Effect.catchTag(
          "Pty.NotFoundError",
          (error) =>
            new ApiError.PtyNotFoundError({
              ptyID: error.ptyID,
              message: `PTY session not found: ${error.ptyID}`,
            }),
        ),
        Effect.flatMap((info) =>
          info.status === "running"
            ? Effect.succeed(info)
            : new ApiError.PtyNotFoundError({
                ptyID: ctx.params.ptyID,
                message: `PTY session not found: ${ctx.params.ptyID}`,
              }),
        ),
      )
    })

    const update = Effect.fn("PtyHttpApi.update")(function* (ctx: {
      params: { ptyID: PtyID }
      payload: typeof Pty.UpdateInput.Type
    }) {
      yield* get(ctx)
      return yield* pty(
        Pty.Service.use((service) =>
          service.update(ctx.params.ptyID, {
            ...ctx.payload,
            size: ctx.payload.size ? { ...ctx.payload.size } : undefined,
          }),
        ),
      ).pipe(
        Effect.catchTag(
          "Pty.NotFoundError",
          (error) =>
            new ApiError.PtyNotFoundError({
              ptyID: error.ptyID,
              message: `PTY session not found: ${error.ptyID}`,
            }),
        ),
      )
    })

    const remove = Effect.fn("PtyHttpApi.remove")(function* (ctx: { params: { ptyID: PtyID } }) {
      yield* get(ctx)
      yield* pty(Pty.Service.use((service) => service.remove(ctx.params.ptyID))).pipe(
        Effect.catchTag(
          "Pty.NotFoundError",
          (error) =>
            new ApiError.PtyNotFoundError({
              ptyID: error.ptyID,
              message: `PTY session not found: ${error.ptyID}`,
            }),
        ),
      )
      return true
    })

    const connectToken = Effect.fn("PtyHttpApi.connectToken")(function* (ctx: { params: { ptyID: PtyID } }) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const token = request.headers[PTY_CONNECT_TOKEN_TENON_HEADER] ?? request.headers[PTY_CONNECT_TOKEN_HEADER]
      if (token !== PTY_CONNECT_TOKEN_HEADER_VALUE || !validOrigin(request, cors))
        return yield* new ApiError.PtyForbiddenError({ message: "Invalid PTY connect token request" })
      yield* get(ctx)
      return yield* tickets.issue({ ptyID: ctx.params.ptyID, ...(yield* ticketScope) })
    })

    return handlers
      .handle("shells", shells)
      .handle("list", list)
      .handle("create", create)
      .handle("get", get)
      .handle("update", update)
      .handle("remove", remove)
      .handle("connectToken", connectToken)
  }),
).pipe(Layer.provide(locationServiceMapLayer))

export const ptyConnectHandlers = HttpApiBuilder.group(PtyConnectApi, "pty-connect", (handlers) =>
  Effect.gen(function* () {
    const tickets = yield* PtyTicket.Service
    const cors = yield* CorsConfig
    const locations = yield* LocationServiceMap.Service
    const unregister = registerDisposer((directory) =>
      Effect.runPromise(locations.invalidate(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    )
    yield* Effect.addFinalizer(() => Effect.sync(unregister))

    const pty = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
        ),
      )
    })

    return handlers.handleRaw(
      "connect",
      Effect.fn("PtyHttpApi.connect")(function* (ctx: {
        params: { ptyID: PtyID }
        request: HttpServerRequest.HttpServerRequest
      }) {
        const exists = yield* pty(Pty.Service.use((service) => service.get(ctx.params.ptyID))).pipe(
          Effect.map((info) => info.status === "running"),
          Effect.catchTag("Pty.NotFoundError", () => Effect.succeed(false)),
        )
        if (!exists) return HttpServerResponse.empty({ status: 404 })

        const query = Schema.decodeUnknownOption(CursorQuery)(yield* HttpServerRequest.ParsedSearchParams)
        if (Option.isNone(query)) return HttpServerResponse.empty({ status: 400 })
        const ticket = new URL(ctx.request.url, "http://localhost").searchParams.get(PTY_CONNECT_TICKET_QUERY)
        if (ticket) {
          const valid = validOrigin(ctx.request, cors)
            ? yield* tickets.consume({ ticket, ptyID: ctx.params.ptyID, ...(yield* ticketScope) })
            : false
          if (!valid) return HttpServerResponse.empty({ status: 403 })
        }
        const parsedCursor = query.value.cursor === undefined ? undefined : Number(query.value.cursor)
        const cursor =
          parsedCursor !== undefined && Number.isSafeInteger(parsedCursor) && parsedCursor >= -1
            ? parsedCursor
            : undefined
        const socket = yield* Effect.orDie(ctx.request.upgrade)
        const { write } = yield* socket.writer
        const closeAccepted = (event: Socket.CloseEvent) =>
          runRaw(socket, () => Effect.void, { onOpen: write(event).pipe(Effect.catch(() => Effect.void)) }).pipe(
            Effect.timeout("1 second"),
            Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
            Effect.catch(() => Effect.void),
          )
        const registered = yield* WebSocketTracker.register(write(WebSocketTracker.SERVER_CLOSING_EVENT()))
        if (!registered) {
          yield* closeAccepted(WebSocketTracker.SERVER_CLOSING_EVENT())
          return HttpServerResponse.empty()
        }

        // Outbound frames flow through one queue drained by a single writer so replay, live
        // output, and the close frame keep their order.
        const outbox = yield* Queue.unbounded<string | Uint8Array | Socket.CloseEvent>()
        // Bounded by bytes: a slow client is closed and resyncs from its cursor rather than growing memory.
        const budget = PtyProtocol.pendingBudget()
        const offerOutput = (chunk: string | Uint8Array) => {
          const admitted = budget.admit(chunk)
          if (admitted === "send") Queue.offerUnsafe(outbox, chunk)
          else if (admitted === "close")
            Queue.offerUnsafe(
              outbox,
              new Socket.CloseEvent(PtyProtocol.TOO_SLOW_CLOSE.code, PtyProtocol.TOO_SLOW_CLOSE.reason),
            )
        }
        const attachment = yield* pty(
          Pty.Service.use((service) =>
            service.attach(ctx.params.ptyID, {
              cursor,
              onData: offerOutput,
              onEnd: () => Queue.offerUnsafe(outbox, new Socket.CloseEvent(1000)),
            }),
          ),
        ).pipe(
          Effect.catchTags({
            "Pty.NotFoundError": () =>
              closeAccepted(new Socket.CloseEvent(4404, "session not found")).pipe(Effect.as(undefined)),
            "Pty.ExitedError": () =>
              closeAccepted(new Socket.CloseEvent(4404, "session not found")).pipe(Effect.as(undefined)),
          }),
        )
        if (!attachment) return HttpServerResponse.empty()

        for (const chunk of PtyProtocol.chunks(attachment.replay)) offerOutput(chunk)
        offerOutput(PtyProtocol.metaFrame(attachment.cursor))
        attachment.activate()

        const drain = Effect.gen(function* () {
          while (true) {
            const item = yield* Queue.take(outbox)
            yield* write(item)
            if (!(item instanceof Socket.CloseEvent)) budget.sent(item)
            if (item instanceof Socket.CloseEvent) return
          }
        })

        // The reader runs concurrently with the writer; whichever finishes first ends the
        // connection and the attachment is always released.
        yield* Effect.race(
          drain,
          runRaw(socket, (message) => {
            const decoded = PtyProtocol.decodeInput(message)
            if (decoded !== undefined) attachment.write(decoded)
          }),
        ).pipe(
          Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
          Effect.ensuring(Effect.sync(() => attachment.detach())),
          Effect.orDie,
        )
        return HttpServerResponse.empty()
      }),
    )
  }),
).pipe(Layer.provide(locationServiceMapLayer))
