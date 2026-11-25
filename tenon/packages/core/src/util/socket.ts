import { Effect } from "effect"
import { Socket } from "effect/socket"

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
