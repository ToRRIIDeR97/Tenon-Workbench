import { NodeFileSystem } from "@effect/platform-node"
import { Deferred, Effect, Exit, Layer, Ref, Scope, Semaphore } from "effect"
import { Socket } from "effect/socket"
import * as CassetteService from "./cassette.js"
import { canonicalizeJson, decodeJson, safeText } from "./matching.js"
import { makeReplayState, resolveAutoMode } from "./recorder.js"
import { make, type Redactor } from "./redactor.js"
import { webSocketInteractions } from "./schema.js"
import type {
  RecorderOptions,
  WebSocketEvent,
  WebSocketInteraction,
  WebSocketRecorderOptions,
  WebSocketRequest,
} from "./types.js"

interface ActiveReplay {
  readonly interaction: WebSocketInteraction
  readonly progress: Ref.Ref<{ readonly position: number; readonly changed: Deferred.Deferred<void> }>
  readonly writeLock: Semaphore.Semaphore
  readonly closed: Ref.Ref<boolean>
}

interface ActiveRecording {
  readonly events: Array<WebSocketEvent>
  readonly eventLock: Semaphore.Semaphore
  readonly accepting: Ref.Ref<boolean>
  opened: boolean
  closed: boolean
  valid: boolean
}

type Frame = string | Uint8Array

const encodeEvent = (direction: "client" | "server", message: Frame): WebSocketEvent =>
  typeof message === "string"
    ? { direction, kind: "text", body: message }
    : { direction, kind: "binary", body: Buffer.from(message).toString("base64"), bodyEncoding: "base64" }

const decodeEvent = (event: WebSocketEvent): Frame =>
  event.kind === "text" ? event.body : new Uint8Array(Buffer.from(event.body, "base64"))

const redactEvent = (event: WebSocketEvent, redactor: Redactor): WebSocketEvent => {
  if (event.kind === "binary") return event
  const body =
    event.direction === "client"
      ? redactor.request({ method: "WEBSOCKET", url: "", headers: {}, body: event.body }).body
      : redactor.response({ status: 101, headers: {}, body: event.body }).body
  return { ...event, body }
}

const comparable = (event: WebSocketEvent, asJson: boolean) => {
  if (!asJson || event.kind === "binary") return JSON.stringify(canonicalizeJson(event))
  const decoded = decodeJson(event.body)
  return JSON.stringify(
    canonicalizeJson({
      ...event,
      body: decoded._tag === "None" ? event.body : canonicalizeJson(decoded.value),
    }),
  )
}

const assertEvent = (actual: WebSocketEvent, expected: WebSocketEvent | undefined, index: number, asJson: boolean) =>
  Effect.sync(() => {
    if (expected && comparable(actual, asJson) === comparable(expected, asJson)) return
    throw new Error(`WebSocket event ${index + 1}: expected ${safeText(expected)}, received ${safeText(actual)}`)
  })

// Replay ends like a server that closed normally once the transcript is done.
const normalClose = () => new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) })

const isCloseError = (error: unknown) => Socket.isSocketError(error) && error.reason._tag === "SocketCloseError"

const openSnapshot = (request: WebSocketRequest, redactor: Redactor) => {
  const snapshot = redactor.request({ method: "GET", url: request.url, headers: request.headers ?? {}, body: "" })
  return { url: snapshot.url, headers: snapshot.headers }
}

const makeRecordingSocket = (
  upstream: Socket.Socket,
  cassette: CassetteService.Interface,
  name: string,
  request: WebSocketRequest,
  options: WebSocketRecorderOptions,
  redactor: Redactor,
) =>
  Effect.gen(function* () {
    const active = yield* Ref.make<ActiveRecording | undefined>(undefined)
    const writeLock = yield* Semaphore.make(1)

    // A connection is one reader acquisition. Its scope decides whether the
    // transcript is complete: the run succeeded, or the peer closed the socket.
    const reader: Socket.Socket["reader"] = Effect.gen(function* () {
      const state: ActiveRecording = {
        events: [],
        eventLock: yield* Semaphore.make(1),
        accepting: yield* Ref.make(true),
        opened: false,
        closed: false,
        valid: true,
      }
      const occupied = yield* Ref.modify(active, (current) => [current !== undefined, current ?? state])
      if (occupied) return yield* Effect.die("Concurrent runs of a recorded WebSocket are not supported")
      yield* Effect.addFinalizer((exit) =>
        writeLock.withPermit(
          state.eventLock.withPermit(
            Effect.gen(function* () {
              yield* Ref.set(state.accepting, false)
              yield* Ref.set(active, undefined)
              if (!(Exit.isSuccess(exit) || state.closed) || !state.opened || !state.valid) return
              yield* cassette
                .append(
                  name,
                  {
                    transport: "websocket",
                    open: openSnapshot(request, redactor),
                    events: [...state.events],
                  },
                  options.metadata,
                )
                .pipe(Effect.orDie)
            }),
          ),
        ),
      )
      const live = yield* upstream.reader
      state.opened = true
      return {
        pull: live.pull.pipe(
          Effect.tap((frames) =>
            Effect.sync(() => {
              if (!Ref.getUnsafe(state.accepting)) throw new Error("WebSocket received a frame after closing")
              for (const frame of frames) state.events.push(redactEvent(encodeEvent("server", frame), redactor))
            }),
          ),
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (isCloseError(error)) state.closed = true
            }),
          ),
        ),
        upgrade: live.upgrade,
      }
    })

    const writer: Socket.Socket["writer"] = upstream.writer.pipe(
      Effect.map((live) => {
        const write = (message: Frame | Socket.CloseEvent) =>
          writeLock.withPermit(
            Effect.gen(function* () {
              if (Socket.isCloseEvent(message)) return yield* live.write(message)
              const state = yield* Ref.get(active)
              if (!state || !(yield* Ref.get(state.accepting)))
                return yield* Effect.die("WebSocket writer used without an active socket run")
              const event = redactEvent(encodeEvent("client", message), redactor)
              yield* state.eventLock.withPermit(Effect.sync(() => state.events.push(event)))
              return yield* live.write(message).pipe(Effect.onError(() => Effect.sync(() => (state.valid = false))))
            }),
          )
        return {
          write,
          writeAll: (messages: ReadonlyArray<Frame>) => Effect.forEach(messages, write, { discard: true }),
        }
      }),
    )

    return Socket.make({ reader, writer })
  })

const makeReplaySocket = (
  cassette: CassetteService.Interface,
  name: string,
  request: WebSocketRequest,
  options: WebSocketRecorderOptions,
  redactor: Redactor,
): Effect.Effect<Socket.Socket, never, Scope.Scope> =>
  Effect.gen(function* () {
    const replay = yield* makeReplayState(cassette, name, webSocketInteractions)
    const active = yield* Ref.make<ActiveReplay | undefined>(undefined)

    const reader: Socket.Socket["reader"] = Effect.gen(function* () {
      const claimed = yield* replay
        .claim((interaction, index) =>
          Effect.sync(() => {
            const incoming = openSnapshot(request, redactor)
            if (
              interaction &&
              JSON.stringify(canonicalizeJson(incoming)) === JSON.stringify(canonicalizeJson(interaction.open))
            )
              return
            throw new Error(
              `WebSocket open ${index + 1}: expected ${safeText(interaction?.open)}, received ${safeText(incoming)}`,
            )
          }),
        )
        .pipe(Effect.orDie)
      const state: ActiveReplay = {
        interaction: claimed.interaction,
        progress: yield* Ref.make({ position: 0, changed: yield* Deferred.make<void>() }),
        writeLock: yield* Semaphore.make(1),
        closed: yield* Ref.make(false),
      }
      const occupied = yield* Ref.modify(active, (current) => [current !== undefined, current ?? state])
      if (occupied) return yield* Effect.die("Concurrent runs of a replayed WebSocket are not supported")
      yield* Effect.addFinalizer(() => Ref.set(active, undefined))

      // Release every server frame up to the next client frame, then wait for
      // the application to send it. The transcript's end is a normal close.
      const pull: Socket.Reader["pull"] = Effect.gen(function* () {
        while (true) {
          const current = yield* Ref.get(state.progress)
          const events = state.interaction.events
          if (current.position >= events.length) return yield* Effect.fail(normalClose())
          if (yield* Ref.get(state.closed))
            return yield* Effect.die(
              new Error(`WebSocket closed with unconsumed events: used ${current.position} of ${events.length}`),
            )
          let end = current.position
          while (end < events.length && events[end].direction === "server") end++
          if (end === current.position) {
            yield* Deferred.await(current.changed)
            continue
          }
          yield* Ref.set(state.progress, { position: end, changed: yield* Deferred.make<void>() })
          const [first, ...rest] = events.slice(current.position, end).map(decodeEvent)
          return [first, ...rest] as const
        }
      })
      return { pull, upgrade: Socket.SocketUpgradeError.unsupported }
    })

    const write = (message: Frame | Socket.CloseEvent) =>
      Ref.get(active).pipe(
        Effect.flatMap((state) =>
          state
            ? state.writeLock.withPermit(
                Effect.gen(function* () {
                  const current = yield* Ref.get(state.progress)
                  if (Socket.isCloseEvent(message)) {
                    yield* Ref.set(state.closed, true)
                    yield* Deferred.succeed(current.changed, undefined)
                    if (current.position === state.interaction.events.length) return
                    return yield* Effect.die(
                      new Error(
                        `WebSocket closed with unconsumed events: used ${current.position} of ${state.interaction.events.length}`,
                      ),
                    )
                  }
                  const actual = redactEvent(encodeEvent("client", message), redactor)
                  yield* assertEvent(
                    actual,
                    state.interaction.events[current.position],
                    current.position,
                    options.compareClientMessagesAsJson === true,
                  )
                  yield* Ref.set(state.progress, {
                    position: current.position + 1,
                    changed: yield* Deferred.make<void>(),
                  })
                  yield* Deferred.succeed(current.changed, undefined)
                }),
              )
            : Effect.die("WebSocket writer used without an active socket run"),
        ),
      )

    return Socket.make({
      reader,
      writer: Effect.succeed({
        write,
        writeAll: (messages: ReadonlyArray<Frame>) => Effect.forEach(messages, write, { discard: true }),
      }),
    })
  })

const recordingLayer = (
  name: string,
  request: WebSocketRequest,
  options: WebSocketRecorderOptions,
  forcedMode?: "record" | "replay",
): Layer.Layer<Socket.Socket, never, Socket.Socket | CassetteService.Service> =>
  Layer.effect(
    Socket.Socket,
    Effect.gen(function* () {
      const upstream = yield* Socket.Socket
      const cassette = yield* CassetteService.Service
      const redactor = make(options.redact)
      if ((forcedMode ?? (yield* resolveAutoMode(cassette, name))) === "record")
        return yield* makeRecordingSocket(upstream, cassette, name, request, options, redactor)
      return yield* makeReplaySocket(cassette, name, request, options, redactor)
    }),
  )

/**
 * Wraps a provided `Socket.Socket` with cassette recording and replay.
 *
 * Supply the ordinary URL-bound Effect socket layer beneath this decorator.
 * The cassette name identifies the connection; recorder configuration does not
 * duplicate the transport URL.
 */
export const socket = (name: string, options: RecorderOptions = {}): Layer.Layer<Socket.Socket, never, Socket.Socket> =>
  provideCassette(recordingLayer(name, { url: "" }, { ...options, compareClientMessagesAsJson: true }), options)

/** @internal */
export const socketLayer = (
  name: string,
  request: WebSocketRequest,
  options: WebSocketRecorderOptions & { readonly mode: "record" | "replay" },
): Layer.Layer<Socket.Socket, never, Socket.Socket> =>
  provideCassette(recordingLayer(name, request, options, options.mode), options)

const provideCassette = (
  layer: Layer.Layer<Socket.Socket, never, Socket.Socket | CassetteService.Service>,
  options: WebSocketRecorderOptions,
) =>
  layer.pipe(
    Layer.provide(CassetteService.fileSystem({ directory: options.directory })),
    Layer.provide(NodeFileSystem.layer),
  )
