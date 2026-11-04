import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { AcpHarness } from "@tenon/core/harness/acp"
import { AppProcess } from "@tenon/core/process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(AppProcess.node))

// A real child process speaking ACP over stdio: its prompt only ends when the client sends session/cancel.
const agent = `
let buffer = ""
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n")
let prompt
process.stdin.on("data", (chunk) => {
  buffer += chunk
  const lines = buffer.split("\\n")
  buffer = lines.pop()
  for (const line of lines.filter(Boolean)) {
    const message = JSON.parse(line)
    if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } })
    if (message.method === "session/new") send({ id: message.id, result: { sessionId: "s1" } })
    if (message.method === "session/prompt") {
      prompt = message.id
      send({
        method: "session/update",
        params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working" } } },
      })
    }
    if (message.method === "session/cancel") send({ id: prompt, result: { stopReason: "cancelled" } })
  }
})
`

it.live("a waiting steer ends a harness turn through session/cancel, and the turn finishes normally", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "tenon-acp-steer-")))
    const script = path.join(dir, "agent.cjs")
    yield* Effect.promise(() => Bun.write(script, agent))
    const process = yield* AppProcess.Service
    const session = yield* AcpHarness.open(process, {
      settings: { command: globalThis.process.execPath, args: [script], env: {}, models: [] },
      directory: dir,
      approve: () => Effect.succeed(false),
    })
    const steer = yield* Deferred.make<void>()
    const turn = yield* session
      .turn({ text: "Long task", steer: Deferred.await(steer) })
      .pipe(Stream.runCollect, Effect.forkChild)

    yield* Effect.sleep("200 millis")
    expect(turn.pollUnsafe()).toBeUndefined()

    yield* Deferred.succeed(steer, undefined)
    const events = yield* Fiber.join(turn).pipe(Effect.timeout("5 seconds"))
    expect(events.map((event) => event.type)).toEqual([
      "step-start",
      "text-start",
      "text-delta",
      "text-end",
      "step-finish",
      "finish",
    ])
    expect(events.at(-1)).toMatchObject({ reason: "stop" })
  }).pipe(Effect.scoped),
)

it.effect("a turn with no steer signal is left alone", () =>
  Effect.gen(function* () {
    let stopped = 0
    const stop = Effect.sync(() => stopped++)
    expect(yield* AcpHarness.stopOnSteer(Stream.make(1, 2), undefined, stop).pipe(Stream.runCollect)).toEqual([1, 2])
    expect(yield* AcpHarness.stopOnSteer(Stream.make(1, 2), Effect.never, stop).pipe(Stream.runCollect)).toEqual([1, 2])
    expect(stopped).toBe(0)
  }),
)
