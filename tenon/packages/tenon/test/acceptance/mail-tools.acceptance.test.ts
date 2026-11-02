import { afterEach, describe, expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { CrossSpawnSpawner } from "@tenon/core/cross-spawn-spawner"
import { Database } from "@tenon/core/database/database"
import { Ripgrep } from "@tenon/core/ripgrep"
import { Workspace } from "../../src/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { AgentAppTools } from "../../src/agents/app-tools"
import { CommandMemory } from "../../src/agents/command-memory"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// P8 · Email, AC-8.4 (implementations/notes-command-centre/implementation.md)

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(
      LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
      [[InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrapService.Service, InstanceBootstrapService.Service.of({ run: Effect.void }))]],
    ),
    AppNodeBuilder.build(CrossSpawnSpawner.node),
  ),
)
type Result = { isError: boolean; value: unknown }

const commandSession = Effect.gen(function* () {
  process.env.TENON_VAULT_DIR = yield* tmpdirScoped()
  const directory = yield* CommandMemory.directory()
  yield* Effect.promise(() => mkdir(directory, { recursive: true }))
  return yield* Session.use.create({ title: "inbox" }).pipe(provideInstanceEffect(directory))
})

afterEach(async () => {
  delete process.env.TENON_VAULT_DIR
  delete process.env.TENON_MAIL_URL
  delete process.env.TENON_MAIL_TOKEN
  await disposeAllInstances()
  await resetDatabase()
})

describe("mail tools", () => {
  it.instance("AC-8.4 mail tools are absent without the desktop mail endpoint", () =>
    Effect.gen(function* () {
      const session = yield* commandSession
      const names = AgentAppTools.list({ sessionID: session.id }).map((tool) => tool.name)
      expect(names).not.toContain("mail_search")
    }),
  )

  it.instance("AC-8.4 mail tools call the desktop endpoint with the bearer token; drafts publish an email write", () =>
    Effect.gen(function* () {
      const seen: { path: string; auth: string | null; body: unknown }[] = []
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
          const url = new URL(request.url)
          seen.push({ path: url.pathname, auth: request.headers.get("authorization"), body: await request.json() })
          if (url.pathname.endsWith("/search")) return Response.json([{ id: "t1", subject: "Invoice", from: "billing@vendor.com", date: "2026-11-02", snippet: "Pay" }])
          if (url.pathname.endsWith("/draft")) return Response.json({ id: "d1" })
          return Response.json({ id: "t1", messages: [] })
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
      process.env.TENON_MAIL_URL = `http://127.0.0.1:${server.port}/mail`
      process.env.TENON_MAIL_TOKEN = "secret-token"
      const session = yield* commandSession
      const names = AgentAppTools.list({ sessionID: session.id }).map((tool) => tool.name)
      for (const name of ["mail_search", "mail_read", "mail_draft"]) expect(names).toContain(name)

      const search = (yield* AgentAppTools.call("mail_search", { query: "invoice" }, { sessionID: session.id })) as Result
      expect(search.isError).toBe(false)
      expect(JSON.stringify(search.value)).toContain("Invoice")
      expect(seen[0]).toMatchObject({ path: "/mail/search", auth: "Bearer secret-token", body: { query: "invoice" } })

      const kinds: string[] = []
      const listen = (event: GlobalEvent) => {
        if (event.payload?.type === "agent.write") kinds.push(event.payload.properties.kind)
      }
      GlobalBus.on("event", listen)
      const draft = (yield* AgentAppTools.call(
        "mail_draft",
        { to: "billing@vendor.com", subject: "Re: Invoice", body: "Thanks" },
        { sessionID: session.id },
      ).pipe(Effect.ensuring(Effect.sync(() => GlobalBus.off("event", listen))))) as Result
      expect(draft.isError).toBe(false)
      expect(seen.at(-1)?.path).toBe("/mail/draft")
      expect(kinds).toContain("email")
    }),
  )

  it.instance("AC-8.4 project threads never get mail tools", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      process.env.TENON_MAIL_URL = "http://127.0.0.1:9/mail"
      process.env.TENON_MAIL_TOKEN = "t"
      process.env.TENON_VAULT_DIR = yield* tmpdirScoped()
      const session = yield* Session.use.create({ title: "project work" }).pipe(provideInstanceEffect(test.directory))
      const names = AgentAppTools.list({ sessionID: session.id }).map((tool) => tool.name)
      expect(names).not.toContain("mail_draft")
    }),
  )
})
