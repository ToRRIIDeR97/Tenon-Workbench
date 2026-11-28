import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Database } from "@tenon/core/database/database"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { ThreadSearch } from "@tenon/core/thread-search"
import { ProjectV2 } from "@tenon/core/project"
import { ProjectTable } from "@tenon/core/project/sql"
import { AbsolutePath } from "@tenon/core/schema"
import { MessageTable, PartTable, SessionMessageTable, SessionTable } from "@tenon/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node]), []))

describe("AC-18 thread text (verification)", () => {
  test("only user text, assistant text and visible v1 text parts are searchable", () => {
    expect(ThreadSearch.rowText({ store: "v2", type: "user", data: { text: "hi" } })).toBe("hi")
    expect(
      ThreadSearch.rowText({
        store: "v2",
        type: "assistant",
        data: {
          content: [
            { type: "reasoning", text: "secret thoughts" },
            { type: "text", text: "visible" },
            { type: "tool", state: { output: "tool output" } },
          ],
        },
      }),
    ).toBe("visible")
    expect(ThreadSearch.rowText({ store: "v2", type: "tool", data: { output: "x" } })).toBe("")
    expect(ThreadSearch.rowText({ store: "v1", data: { type: "text", text: "old" } })).toBe("old")
    expect(ThreadSearch.rowText({ store: "v1", data: { type: "text", text: "s", synthetic: true } })).toBe("")
    expect(ThreadSearch.rowText({ store: "v1", data: { type: "reasoning", text: "r" } })).toBe("")
  })
})

describe("AC-18 ThreadSearch (verification)", () => {
  it.effect("v1 threads are found, wildcards are literal, short queries and limits hold", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make("/work"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
      for (const [id, title] of [
        ["ses_1", "one"],
        ["ses_2", "two"],
        ["ses_3", "three"],
      ])
        yield* db
          .insert(SessionTable)
          .values({ id: id as never, project_id: ProjectV2.ID.global, slug: id, directory: "/w", title, version: "t" })
          .run()
      yield* db
        .insert(MessageTable)
        .values({
          id: "m1" as never,
          session_id: "ses_1" as never,
          time_created: 1,
          time_updated: 1,
          data: {} as never,
        })
        .run()
      yield* db
        .insert(PartTable)
        .values({
          id: "p1" as never,
          message_id: "m1" as never,
          session_id: "ses_1" as never,
          time_created: 1,
          time_updated: 1,
          data: { type: "text", text: "coverage is 100% now" } as never,
        })
        .run()
      yield* db
        .insert(SessionMessageTable)
        .values([
          {
            id: "msg_a" as never,
            session_id: "ses_2" as never,
            type: "user" as never,
            seq: 1,
            time_created: 2,
            time_updated: 2,
            data: { text: "coverage is 1000 lines" } as never,
          },
          {
            id: "msg_b" as never,
            session_id: "ses_3" as never,
            type: "user" as never,
            seq: 1,
            time_created: 3,
            time_updated: 3,
            data: { text: "coverage report" } as never,
          },
        ])
        .run()
      expect((yield* ThreadSearch.search("100%", 8)).map((hit) => hit.id)).toEqual(["ses_1"])
      expect((yield* ThreadSearch.search("coverage", 8)).length).toBe(3)
      expect((yield* ThreadSearch.search("coverage", 2)).length).toBe(2)
      expect(yield* ThreadSearch.search("c", 8)).toEqual([])
    }),
  )
})
