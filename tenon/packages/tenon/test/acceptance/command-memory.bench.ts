// Not part of the test suite (the name doesn't match *.test.ts). Run it on purpose, from packages/tenon:
//   bun test ./test/acceptance/command-memory.bench.ts --timeout 600000
// It times Command Centre memory search over many threads and the workspace-folder de-duplication.
import { afterEach, describe, expect, test as bunTest } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { Database } from "@tenon/core/database/database"
import { canonicalDirectory } from "@tenon/core/util/directory"
import { CrossSpawnSpawner } from "@tenon/core/cross-spawn-spawner"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { SessionProjector } from "@tenon/core/session/projector"
import { AgentAppTools } from "../../src/agents/app-tools"
import { CommandMemory } from "../../src/agents/command-memory"
import { MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const THREADS = 300
const MESSAGES = 50

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      InstanceStore.node,
      Project.node,
      Session.node,
      SessionProjector.node,
      Database.node,
      CrossSpawnSpawner.node,
    ]),
    [
      [
        InstanceStore.bootstrapNode,
        Layer.succeed(InstanceBootstrapService.Service, InstanceBootstrapService.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

afterEach(async () => {
  delete process.env.TENON_VAULT_DIR
  await disposeAllInstances()
  await resetDatabase()
})

const timed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const start = performance.now()
    const value = yield* effect
    return { value, ms: Math.round(performance.now() - start) }
  })

describe("Command Centre bench", () => {
  it.instance(
    `memory search over ${THREADS} threads x ${MESSAGES} messages`,
    () =>
      Effect.gen(function* () {
        process.env.TENON_VAULT_DIR = yield* tmpdirScoped()
        const folder = yield* CommandMemory.directory()
        const sessions = yield* Session.Service
        const ids = yield* Effect.forEach(
          Array.from({ length: THREADS }, (_, index) => index),
          (index) =>
            Effect.gen(function* () {
              const thread = yield* sessions.create({ title: `Thread ${index}` })
              for (let message = 0; message < MESSAGES; message++) {
                const id = MessageID.ascending()
                yield* sessions.updateMessage({
                  id,
                  sessionID: thread.id,
                  role: "user",
                  time: { created: Date.now() },
                  agent: "test",
                  model: { providerID: "test", modelID: "test" },
                  tools: {},
                  mode: "",
                } as never)
                yield* sessions.updatePart({
                  id: PartID.ascending(),
                  sessionID: thread.id,
                  messageID: id,
                  type: "text",
                  text: `Message ${message} of thread ${index} about billing webhooks, retries and the release plan. `.repeat(
                    3,
                  ),
                })
              }
              return thread.id
            }).pipe(provideInstanceEffect(folder)),
          { concurrency: 8 },
        )
        let reads = 0
        const counted = Effect.provideService(Session.Service, {
          ...sessions,
          messages: (input) => {
            reads++
            return sessions.messages(input)
          },
        })
        const run = (query: string) =>
          Effect.gen(function* () {
            reads = 0
            const result = yield* timed(CommandMemory.search(query).pipe(counted))
            return { hits: result.value.length, ms: result.ms, reads }
          })
        const first = yield* run("billing")
        const second = yield* run("release")
        yield* Session.use
          .setTitle({ sessionID: ids[0], title: "Thread zero renamed" })
          .pipe(provideInstanceEffect(folder))
        const afterEdit = yield* run("renamed")
        console.log(JSON.stringify({ threads: THREADS, messages: MESSAGES, first, second, afterEdit }))
        expect(afterEdit.hits).toBe(1)
      }),
    600_000,
  )

  bunTest("workspace folder de-duplication at n=1000", () => {
    const key = (directory: string) => canonicalDirectory(directory)
    // 200 recent threads, each with its ancestor folders: mostly repeats, as in workspaceCandidates.
    const input = Array.from({ length: 200 }, (_, index) =>
      path.resolve("bench-root", "workspaces", `w${index % 20}`, "projects", `p${index}`),
    ).flatMap((directory) => [
      directory,
      path.dirname(directory),
      path.dirname(path.dirname(directory)),
      path.dirname(path.dirname(path.dirname(directory))),
      path.resolve("bench-root"),
    ])
    const measure = (run: () => string[]) => {
      const start = performance.now()
      for (let round = 0; round < 20; round++) run()
      return { ms: Number(((performance.now() - start) / 20).toFixed(3)), out: run() }
    }
    const before = measure(() => input.filter((d, i, all) => all.findIndex((other) => key(other) === key(d)) === i))
    const after = measure(() => AgentAppTools.distinctDirectories(input))
    console.log(JSON.stringify({ n: input.length, unique: after.out.length, beforeMs: before.ms, afterMs: after.ms }))
    expect(after.out).toEqual(before.out)
  })
})
