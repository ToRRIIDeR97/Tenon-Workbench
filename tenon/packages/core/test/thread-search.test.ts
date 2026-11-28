import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@tenon/core/database/database"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { ThreadSearch } from "@tenon/core/thread-search"
import { ProjectV2 } from "@tenon/core/project"
import { ProjectTable } from "@tenon/core/project/sql"
import { AbsolutePath } from "@tenon/core/schema"
import { SessionMessageTable, SessionTable } from "@tenon/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node]), []))

const seed = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  yield* db
    .insert(ProjectTable)
    .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make("/work"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
  const session = (id: string, title: string, archived?: number) =>
    db
      .insert(SessionTable)
      .values({
        id: id as never,
        project_id: ProjectV2.ID.global,
        slug: id,
        directory: "/work/alpha",
        title,
        version: "test",
        ...(archived ? { time_archived: archived } : {}),
      })
      .run()
  const message = (id: string, session: string, type: string, seq: number, data: unknown) =>
    db
      .insert(SessionMessageTable)
      .values({
        id: id as never,
        session_id: session as never,
        type: type as never,
        seq,
        time_created: seq,
        time_updated: seq,
        data: data as never,
      })
      .run()
  yield* session("ses_a", "Fix login")
  yield* session("ses_b", "Deploy pipeline")
  yield* session("ses_old", "Archived deploy", 10)
  yield* message("msg_1", "ses_a", "user", 1, { text: "Why does the deploy fail?" })
  yield* message("msg_2", "ses_a", "assistant", 2, {
    content: [{ type: "text", text: "The deploy fails because the token expired." }],
  })
  yield* message("msg_3", "ses_old", "user", 1, { text: "deploy again" })
})

describe("AC-18 ThreadSearch", () => {
  it.effect("finds threads by message text and by title, each once, archived excluded", () =>
    Effect.gen(function* () {
      yield* seed
      const hits = yield* ThreadSearch.search("deploy", 8)
      expect(hits.map((hit) => hit.id).sort()).toEqual(["ses_a", "ses_b"])
      const a = hits.find((hit) => hit.id === "ses_a")!
      expect(a.title).toBe("Fix login")
      expect(a.directory).toBe("/work/alpha")
      expect(a.snippet.toLowerCase()).toContain("deploy")
    }),
  )

  it.effect("JSON keys do not match", () =>
    Effect.gen(function* () {
      yield* seed
      expect(yield* ThreadSearch.search("content", 8)).toEqual([])
      expect(yield* ThreadSearch.search("text", 8)).toEqual([])
    }),
  )
})
