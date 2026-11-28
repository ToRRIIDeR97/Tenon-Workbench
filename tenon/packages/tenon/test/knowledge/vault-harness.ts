import { afterEach } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import path from "node:path"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/http"
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
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
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
export const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer, AppNodeBuilder.build(CrossSpawnSpawner.node)))

export const request = (route: string, init?: RequestInit) => {
  const url = new URL(route, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}
export const json = <T>(response: HttpClientResponse.HttpClientResponse) =>
  response.status >= 200 && response.status < 300
    ? response.json.pipe(Effect.map((value) => value as T))
    : response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(`${response.status} ${text}`))))

export const setup = Effect.gen(function* () {
  const test = yield* TestInstance
  const root = yield* tmpdirScoped()
  process.env.TENON_VAULT_DIR = root
  const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
  const project = yield* request("/second-brain/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Acme API", outcome: "Ship" }),
  }).pipe(Effect.flatMap(json<{ id: string }>))
  const vault = yield* request("/second-brain/vault", { headers }).pipe(
    Effect.flatMap(json<{ workspace: { folder: string } }>),
  )
  return { root, headers, project, folder: path.join(root, vault.workspace.folder) }
})

export const put = (headers: Record<string, string>, page: string, body: unknown) =>
  request(`/second-brain/vault/page?path=${encodeURIComponent(page)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  })

afterEach(async () => {
  delete process.env.TENON_VAULT_DIR
  await disposeAllInstances()
  await resetDatabase()
})
