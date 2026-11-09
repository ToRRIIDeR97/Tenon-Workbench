import { Effect } from "effect"
import { Socket } from "effect/socket"

/**
 * Reads every frame from a socket until it closes, running `handler` once per
 * frame in arrival order.
 *
 * Effect 4.1 replaced `socket.runRaw(handler, { onOpen })` with a pull-based
 * reader; this keeps the callback shape the server handlers use. Opening the
 * reader dials or accepts the connection, then `onOpen` runs. A close fails
 * with `SocketError` (reason `SocketCloseError`) unless `closeCodeIsError`
 * returns false for its code, in which case the run succeeds.
 */
export const runRaw = <_, E = never, R = never>(
  socket: Socket.Socket,
  handler: (frame: string | Uint8Array) => Effect.Effect<_, E, R> | void,
  options?: {
    readonly onOpen?: Effect.Effect<void> | undefined
    readonly closeCodeIsError?: ((code: number) => boolean) | undefined
  },
): Effect.Effect<void, Socket.SocketError | E, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const reader = yield* socket.reader
      if (options?.onOpen) yield* options.onOpen
      while (true) {
        const frames = yield* reader.pull
        for (const frame of frames) {
          const result = handler(frame)
          if (Effect.isEffect(result)) yield* result
        }
      }
    }),
  ).pipe(
    Effect.catchIf(
      (error): error is Socket.SocketError =>
        options?.closeCodeIsError !== undefined &&
        Socket.isSocketError(error) &&
        error.reason._tag === "SocketCloseError" &&
        !options.closeCodeIsError(error.reason.code),
      () => Effect.void,
    ),
  )
