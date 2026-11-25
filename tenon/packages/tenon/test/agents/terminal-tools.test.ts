import { afterEach, describe, expect, test } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import path from "node:path"
import { Config, Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { layerWebSocketConstructorGlobal } from "effect/socket/Socket"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { CrossSpawnSpawner } from "@tenon/core/cross-spawn-spawner"
import { Database } from "@tenon/core/database/database"
import { Ripgrep } from "@tenon/core/ripgrep"
import { Workspace } from "../../src/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { AgentAppTools } from "../../src/agents/app-tools"
import { AgentTerminalTools } from "../../src/agents/terminal-tools"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
  [
    [
      InstanceStore.bootstrapNode,
      Layer.succeed(InstanceBootstrapService.Service, InstanceBootstrapService.Service.of({ run: Effect.void })),
    ],
  ],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)
const it = testEffect(
  Layer.mergeAll(
    appLayer,
    servedRoutes.pipe(
      Layer.provide(layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
    AppNodeBuilder.build(CrossSpawnSpawner.node),
  ),
)

type Result = { isError: boolean; value: unknown }
const call = (sessionID: string, name: string, args: Record<string, unknown>) =>
  AgentAppTools.call(name, args, { sessionID }) as Effect.Effect<Result, never, never>

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("AgentTerminalTools", () => {
  it.instance(
    "runs a command in the thread's terminal and reads its output back",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const thread = yield* Session.use.create({ title: "app" }).pipe(provideInstanceEffect(test.directory))
        const child = yield* Session.use
          .create({ title: "child", parentID: thread.id })
          .pipe(provideInstanceEffect(test.directory))
        const other = yield* Session.use.create({ title: "other" }).pipe(provideInstanceEffect(test.directory))

        const started = yield* call(child.id, "terminal_start", { command: "echo tenon-terminal-ok", title: "Echo" })
        expect(started.isError).toBe(false)
        const terminal = started.value as { terminalId: string; title: string; folder: string }
        expect(terminal.title).toBe("Echo")
        expect(path.resolve(terminal.folder)).toBe(path.resolve(test.directory))

        const listed = (yield* call(thread.id, "terminal_read", {})).value as { terminals: { terminalId: string }[] }
        expect(listed.terminals.map((item) => item.terminalId)).toEqual([terminal.terminalId])

        const output = yield* Effect.promise(async () => {
          for (let attempt = 0; attempt < 100; attempt++) {
            const read = await Effect.runPromise(call(thread.id, "terminal_read", { terminalId: terminal.terminalId }))
            const text = (read.value as { output?: string }).output ?? ""
            if (text.split("\n").some((line) => line.trim() === "tenon-terminal-ok")) return text
            await Bun.sleep(100)
          }
          return ""
        })
        expect(output).toContain("tenon-terminal-ok")
        expect(output).not.toContain("\u001b")

        expect(((yield* call(other.id, "terminal_read", {})).value as { terminals: unknown[] }).terminals).toEqual([])
        expect(yield* call(other.id, "terminal_read", { terminalId: terminal.terminalId })).toEqual({
          isError: true,
          value: `No terminal ${terminal.terminalId} in this thread.`,
        })
        expect((yield* call(other.id, "terminal_stop", { terminalId: terminal.terminalId })).isError).toBe(true)

        expect((yield* call(thread.id, "terminal_stop", { terminalId: terminal.terminalId })).isError).toBe(false)
        expect(((yield* call(thread.id, "terminal_read", {})).value as { terminals: unknown[] }).terminals).toEqual([])
      }),
    30_000,
  )

  it.instance("refuses a command with control characters", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const thread = yield* Session.use.create({ title: "app" }).pipe(provideInstanceEffect(test.directory))
      for (const command of ["echo a\necho b", "echo a\u0003", "   "])
        expect((yield* call(thread.id, "terminal_start", { command })).isError).toBe(true)
    }),
  )
})

describe("AgentTerminalTools.plainText", () => {
  test("drops escape sequences and keeps what a carriage return left on the line", () => {
    expect(
      AgentTerminalTools.plainText("\u001b]0;title\u0007\u001b[32mready\u001b[0m\r\nloading 10%\rloading 100%\r\n"),
    ).toBe("ready\nloading 100%\n")
  })

  test("tail keeps the last lines", () => {
    expect(AgentTerminalTools.tail("a\nb\nc\n\n", 2)).toBe("b\nc")
  })
})

describe("AgentAppTools catalog", () => {
  test("threads get the terminal tools; the Command Centre doesn't", () => {
    const root = path.resolve("vault-root-for-terminal-test")
    process.env.TENON_VAULT_DIR = root
    const names = (directory: string) => AgentAppTools.catalogFor(directory).map((tool) => tool.name)
    expect(names(path.resolve("some-workspace", "projects", "Acme"))).toEqual(
      expect.arrayContaining(["terminal_start", "terminal_read", "terminal_stop"]),
    )
    expect(names(path.join(root, ".command-centre"))).not.toContain("terminal_start")
    delete process.env.TENON_VAULT_DIR
  })
})
