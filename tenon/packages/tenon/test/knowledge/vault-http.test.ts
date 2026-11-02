import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { readdir, symlink } from "node:fs/promises"
import path from "node:path"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
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

// Vault behaviour beyond the P3 acceptance tests: Project-relative paths, reserved folders, symlink escapes.

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

const request = (route: string, init?: RequestInit) => {
  const url = new URL(route, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}
const json = <T>(response: HttpClientResponse.HttpClientResponse) =>
  response.status >= 200 && response.status < 300
    ? response.json.pipe(Effect.map((value) => value as T))
    : response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(`${response.status} ${text}`))))

const setup = Effect.gen(function* () {
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

const put = (headers: Record<string, string>, page: string, body: unknown) =>
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

describe("vault routes", () => {
  it.instance("a Project path already inside the Project folder is not nested again", () =>
    Effect.gen(function* () {
      const { headers, project } = yield* setup
      const created = yield* put(headers, "Plan.md", { body: "one", projectId: project.id, create: true }).pipe(
        Effect.flatMap(json<{ info: { path: string }; revision: string }>),
      )
      expect(created.info.path).toBe("Acme API/Plan.md")
      const saved = yield* put(headers, created.info.path, {
        body: "two",
        projectId: project.id,
        expectedRevision: created.revision,
      }).pipe(Effect.flatMap(json<{ info: { path: string; projectId: string } }>))
      expect(saved.info).toMatchObject({ path: "Acme API/Plan.md", projectId: project.id })
    }),
  )

  it.instance("pages cannot be written into a Project's machine logs", () =>
    Effect.gen(function* () {
      const { headers, project } = yield* setup
      const response = yield* put(headers, "log/fake.md", { body: "x", projectId: project.id, create: true })
      expect(response.status).toBe(400)
    }),
  )

  it.instance("a link inside the vault cannot lead a write outside it", () =>
    Effect.gen(function* () {
      const { headers, folder } = yield* setup
      const outside = yield* tmpdirScoped()
      // A junction needs no privileges on Windows; elsewhere it is an ordinary directory symlink.
      yield* Effect.promise(() => symlink(outside, path.join(folder, "Escape"), "junction"))
      const response = yield* put(headers, "Escape/x.md", { body: "x", create: true })
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => readdir(outside))).toEqual([])
    }),
  )

  it.instance("history keeps at most 20 versions, newest first", () =>
    Effect.gen(function* () {
      const { headers, folder } = yield* setup
      let page = yield* put(headers, "Draft.md", { body: "v0", create: true }).pipe(
        Effect.flatMap(json<{ revision: string }>),
      )
      for (let index = 1; index <= 22; index++) {
        page = yield* put(headers, "Draft.md", { body: `v${index}`, expectedRevision: page.revision }).pipe(
          Effect.flatMap(json<{ revision: string }>),
        )
      }
      const history = yield* request("/second-brain/vault/page/history?path=Draft.md", { headers }).pipe(
        Effect.flatMap(json<{ revision: string }[]>),
      )
      expect(history).toHaveLength(20)
      const newest = yield* request(`/second-brain/vault/page/history?path=Draft.md&revision=${history[0]!.revision}`, {
        headers,
      }).pipe(Effect.flatMap(json<{ body: string }>))
      expect(newest.body).toContain("v21")
      expect((yield* Effect.promise(() => readdir(path.join(folder, ".history", "Draft")))).length).toBe(20)
    }),
  )
})
