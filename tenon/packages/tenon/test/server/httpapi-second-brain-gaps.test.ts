import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/http"
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
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer, AppNodeBuilder.build(CrossSpawnSpawner.node)))

function request(route: string, init?: RequestInit) {
  const url = new URL(route, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("F-211 project instructions over HTTP", () => {
  it.instance("reads nothing, writes AGENTS.md, reads it back and removes it", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      const file = path.join(test.directory, "AGENTS.md")
      const empty = yield* request("/second-brain/instructions", { headers })
      expect(empty.status).toBe(200)
      expect(yield* empty.json).toMatchObject({ content: null })
      const written = yield* request("/second-brain/instructions", {
        method: "PUT",
        headers,
        body: JSON.stringify({ content: "# Rules\n\nUse plain words.\n" }),
      })
      expect(written.status).toBe(200)
      expect(yield* written.json).toMatchObject({ content: "# Rules\n\nUse plain words.\n" })
      expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe("# Rules\n\nUse plain words.\n")
      const read = yield* request("/second-brain/instructions", { headers })
      expect(yield* read.json).toMatchObject({ content: "# Rules\n\nUse plain words.\n" })
      const removed = yield* request("/second-brain/instructions", { method: "DELETE", headers })
      expect(removed.status).toBe(200)
      expect(yield* removed.json).toMatchObject({ content: null })
      expect(
        yield* Effect.promise(() =>
          stat(file).then(
            () => "present",
            () => "gone",
          ),
        ),
      ).toBe("gone")
    }),
  )

  it.instance("refuses instructions over the size limit and leaves the file alone", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      const refused = yield* request("/second-brain/instructions", {
        method: "PUT",
        headers,
        body: JSON.stringify({ content: "x".repeat(64 * 1024 + 1) }),
      })
      expect(refused.status).toBe(400)
      const file = path.join(test.directory, "AGENTS.md")
      expect(
        yield* Effect.promise(() =>
          stat(file).then(
            () => "present",
            () => "gone",
          ),
        ),
      ).toBe("gone")
    }),
  )
})

describe("F-504 Command Centre folder over HTTP", () => {
  it.instance("answers a folder that exists, the same one each time", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      const first = yield* request("/command-centre/directory", { method: "POST", headers })
      expect(first.status).toBe(200)
      const answer = (yield* first.json) as { directory: string }
      expect(path.isAbsolute(answer.directory)).toBe(true)
      expect(yield* Effect.promise(() => stat(answer.directory).then((info) => info.isDirectory()))).toBe(true)
      const second = (yield* request("/command-centre/directory", { method: "POST", headers }).pipe(
        Effect.flatMap((response) => response.json),
      )) as { directory: string }
      expect(second.directory).toBe(answer.directory)
    }),
  )
})
