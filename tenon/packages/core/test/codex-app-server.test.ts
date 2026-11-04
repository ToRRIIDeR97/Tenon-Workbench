import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Option, Queue, Sink, Stream } from "effect"
import { make, watchExit } from "../src/harness/codex-app-server"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe("Codex app-server client", () => {
  test("routes responses, notifications, and server requests over one connection", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const incoming = yield* Queue.unbounded<Uint8Array>()
          const outgoing = yield* Queue.unbounded<string>()
          const client = yield* make({
            connection: {
              stdout: Stream.fromQueue(incoming),
              stdin: Sink.forEach((chunk: Uint8Array) => Queue.offer(outgoing, decoder.decode(chunk))),
            },
            handleRequest: () => Effect.succeed({ decision: "accept" }),
          })

          const request = yield* Effect.forkScoped(client.request("model/list", { includeHidden: false }))
          const sent = JSON.parse(yield* Queue.take(outgoing))
          expect(sent).toMatchObject({ id: 1, method: "model/list", params: { includeHidden: false } })
          yield* Queue.offer(incoming, encoder.encode(`${JSON.stringify({ id: sent.id, result: { data: [] } })}\n`))
          expect(yield* Fiber.join(request)).toEqual({ data: [] })

          const notification = yield* Effect.forkScoped(Stream.runHead(client.notifications))
          yield* Queue.offer(
            incoming,
            encoder.encode(`${JSON.stringify({ method: "turn/completed", params: { turn: { id: "turn_1" } } })}\n`),
          )
          expect(Option.getOrUndefined(yield* Fiber.join(notification))).toMatchObject({ method: "turn/completed" })

          yield* Queue.offer(
            incoming,
            encoder.encode(
              `${JSON.stringify({ id: "approval_1", method: "item/commandExecution/requestApproval", params: {} })}\n`,
            ),
          )
          expect(JSON.parse(yield* Queue.take(outgoing))).toEqual({
            id: "approval_1",
            result: { decision: "accept" },
          })
        }),
      ),
    )
  })

  test("skips a stray stdout line, and says why the process ended without showing a secret", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const exit = yield* watchExit({
            stderr: Stream.make(encoder.encode("starting\n\u001b[31mfatal: bad flag, token=abc123\u001b[0m\n\n")),
            exitCode: Effect.sleep("5 millis").pipe(Effect.as(1)),
          })
          const client = yield* make({
            connection: {
              stdout: Stream.make(
                encoder.encode("A new version is available\n"),
                encoder.encode(`${JSON.stringify({ method: "turn/started" })}\n`),
              ),
              stdin: Sink.drain,
            },
            exit,
          })
          const notification = yield* Stream.runHead(client.notifications)
          expect(Option.getOrUndefined(notification)).toMatchObject({ method: "turn/started" })
          const error = yield* client.request("model/list").pipe(Effect.flip)
          expect(error.message).toBe("Codex app-server exited (code 1): fatal: bad flag, token=[redacted]")
        }),
      ),
    )
  })

  test("fails a setup request that is not answered within its timeout", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const incoming = yield* Queue.unbounded<Uint8Array>()
          const client = yield* make({
            connection: { stdout: Stream.fromQueue(incoming), stdin: Sink.drain },
          })

          const error = yield* client.request("thread/start", {}, "20 millis").pipe(Effect.flip)
          expect(error.message).toContain("did not answer thread/start")
        }),
      ),
    )
  })
})
