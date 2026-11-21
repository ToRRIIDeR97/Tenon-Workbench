import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@tenon/core/database/database"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { GithubThreads } from "@tenon/core/github/threads"
import { ProjectV2 } from "@tenon/core/project"
import { ProjectTable } from "@tenon/core/project/sql"
import { AbsolutePath } from "@tenon/core/schema"
import { PartTable, SessionMessageTable, SessionTable, MessageTable } from "@tenon/core/session/sql"
import { testEffect } from "./lib/effect"

// Verification for #331 (plan author's check): the mentions come from the real tables — v2 session messages and v1
// parts — for the Project folder's threads only.
const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node]), []))
const repo = "ToRRIIDeR97/Tenon-Workbench"
const url = (n: number) => `https://github.com/${repo}/pull/${n}`

describe("GithubThreads.mentions", () => {
  it.effect("reads PR links from the folder's threads, in both message stores", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make("/work"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
      const session = (id: string, directory: string, title: string) =>
        db
          .insert(SessionTable)
          .values({ id: id as never, project_id: ProjectV2.ID.global, slug: id, directory, title, version: "test" })
          .run()
      yield* session("ses_v2", "/work/alpha", "Fix login")
      yield* session("ses_v1", "/work/alpha", "Old thread")
      yield* session("ses_elsewhere", "/work/beta", "Other project")
      yield* db
        .insert(SessionMessageTable)
        .values([
          {
            id: "msg_1" as never,
            session_id: "ses_v2" as never,
            type: "tool" as never,
            seq: 1,
            time_created: 200,
            time_updated: 200,
            data: { output: `Created ${url(12)}` } as never,
          },
          {
            id: "msg_2" as never,
            session_id: "ses_elsewhere" as never,
            type: "text" as never,
            seq: 1,
            time_created: 50,
            time_updated: 50,
            data: { text: url(12) } as never,
          },
        ])
        .run()
      yield* db
        .insert(MessageTable)
        .values({
          id: "m_v1" as never,
          session_id: "ses_v1" as never,
          time_created: 100,
          time_updated: 100,
          data: {} as never,
        })
        .run()
      yield* db
        .insert(PartTable)
        .values({
          id: "p_v1" as never,
          message_id: "m_v1" as never,
          session_id: "ses_v1" as never,
          time_created: 100,
          time_updated: 100,
          data: { type: "text", text: `see ${url(9)}` } as never,
        })
        .run()

      const mentions = yield* GithubThreads.mentions("/work/alpha", repo)
      const map = GithubThreads.pullThreads(mentions, repo)
      expect(map.get(12)).toEqual({ id: "ses_v2", title: "Fix login" })
      expect(map.get(9)).toEqual({ id: "ses_v1", title: "Old thread" })
      expect(mentions.some((item) => item.sessionID === "ses_elsewhere")).toBe(false)
    }),
  )
})
