import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { CrossSpawnSpawner } from "@tenon/core/cross-spawn-spawner"
import { Database } from "@tenon/core/database/database"
import { HarnessDelegation } from "@tenon/core/harness/delegation"
import { Ripgrep } from "@tenon/core/ripgrep"
import { Workspace } from "../../src/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { AgentAppTools } from "../../src/agents/app-tools"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// Undo per kind, workspace threads and MCP routing of the app tools (P5, beyond the acceptance set).

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

type Result = { isError: boolean; value: unknown }

const setup = Effect.gen(function* () {
  const test = yield* TestInstance
  process.env.TENON_VAULT_DIR = yield* tmpdirScoped()
  const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
  const project = yield* request("/second-brain/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Alpha", outcome: "x" }),
  }).pipe(Effect.flatMap(json<{ id: string; location?: { path?: string } }>))
  const folder = path.join(test.directory, project.location?.path ?? "projects/Alpha")
  yield* Effect.promise(() => mkdir(folder, { recursive: true }))
  const thread = yield* Session.use.create({ title: "alpha" }).pipe(provideInstanceEffect(folder))
  const workspaceThread = yield* Session.use.create({ title: "workspace" }).pipe(provideInstanceEffect(test.directory))
  const call = (sessionID: string, name: string, args: Record<string, unknown>) =>
    AgentAppTools.call(name, args, { sessionID }) as Effect.Effect<Result, never, never>
  const undo = (token: string) =>
    request(`/second-brain/writes/${encodeURIComponent(token)}/undo`, { method: "POST", headers }).pipe(
      Effect.map((response) => response.status),
    )
  const calendar = request("/second-brain/calendar", { headers }).pipe(
    Effect.flatMap(json<{ events: { title: string }[]; tasks: { title: string }[] }>),
  )
  return { headers, project, thread, workspaceThread, call, undo, calendar }
})

afterEach(async () => {
  delete process.env.TENON_VAULT_DIR
  await disposeAllInstances()
  await resetDatabase()
})

describe("AgentAppTools undo", () => {
  it.instance("removes added calendar events and tasks once", () =>
    Effect.gen(function* () {
      const { thread, call, undo, calendar } = yield* setup
      const event = (yield* call(thread.id, "calendar_apply", { events: [{ title: "Review", date: "2026-11-04" }] }))
        .value as { undo: string }
      const task = (yield* call(thread.id, "tasks_create", { tasks: [{ title: "Retry webhooks" }] })).value as {
        undo: string
      }
      expect(yield* undo(event.undo)).toBe(200)
      expect(yield* undo(task.undo)).toBe(200)
      const after = yield* calendar
      expect(after.events.map((item) => item.title)).not.toContain("Review")
      expect(after.tasks.map((item) => item.title)).not.toContain("Retry webhooks")
      expect(yield* undo(event.undo)).toBe(409)
    }),
  )

  it.instance("removes a created page and a log line, and refuses a page changed since", () =>
    Effect.gen(function* () {
      const { thread, call, undo } = yield* setup
      const created = (yield* call(thread.id, "notes_write", { path: "New.md", body: "fresh", create: true }))
        .value as {
        undo: string
        revision: string
      }
      expect(yield* undo(created.undo)).toBe(200)
      expect((yield* call(thread.id, "notes_read", { path: "New.md" })).isError).toBe(true)

      const logged = (yield* call(thread.id, "log_append", { text: "Shipped rate limiting" })).value as { undo: string }
      expect(yield* undo(logged.undo)).toBe(200)

      const first = (yield* call(thread.id, "notes_write", { path: "Kept.md", body: "one", create: true })).value as {
        undo: string
        revision: string
      }
      yield* call(thread.id, "notes_write", { path: "Kept.md", body: "two", expectedRevision: first.revision })
      expect(yield* undo(first.undo)).toBe(409)
      expect(yield* undo("undo_unknown")).toBe(404)
    }),
  )

  it.instance("lets a workspace thread write to a named Project", () =>
    Effect.gen(function* () {
      const { workspaceThread, project, call } = yield* setup
      const written = yield* call(workspaceThread.id, "timeline_update", {
        projectId: project.id,
        items: [{ id: "auth", title: "Auth", kind: "task", status: "done" }],
      })
      expect(written.isError).toBe(false)
      const missing = yield* call(workspaceThread.id, "timeline_get", {})
      expect(missing.isError).toBe(true)
    }),
  )

  it.instance("are listed and called over the tenon MCP server", () =>
    Effect.gen(function* () {
      const { thread } = yield* setup
      const caller = { sessionID: thread.id }
      const listed = (yield* Effect.promise(() =>
        HarnessDelegation.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, caller, undefined),
      )) as { result: { tools: { name: string }[] } }
      expect(listed.result.tools.map((tool) => tool.name)).toContain("notes_write")
      const reply = (yield* Effect.promise(() =>
        HarnessDelegation.handleMessage(
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "timeline_update", arguments: { projectId: "project_01OTHER", items: [] } },
          },
          caller,
          undefined,
        ),
      )) as { result: { isError: boolean; content: { text: string }[] } }
      expect(reply.result.isError).toBe(true)
      expect(reply.result.content[0].text).toContain("outside this Project")
    }),
  )
})
