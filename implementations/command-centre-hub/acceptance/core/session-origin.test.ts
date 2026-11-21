// Run from tenon/packages/core: bun test ../../../Implementations/command-centre-hub/acceptance/core
import { describe, expect, test } from "bun:test"
import { fromRow } from "../../../../tenon/packages/core/src/session/info"

const row = (metadata: Record<string, unknown> | null) =>
  ({
    id: "ses_worker",
    project_id: "prj_1",
    workspace_id: null,
    parent_id: null,
    slug: "s",
    directory: "/work/projects/Alpha X",
    path: null,
    title: "M0 foundation",
    version: "1",
    share_url: null,
    summary_additions: null,
    summary_deletions: null,
    summary_files: null,
    summary_diffs: null,
    metadata,
    cost: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_reasoning: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    revert: null,
    permission: null,
    agent: null,
    model: null,
    time_created: 1,
    time_updated: 2,
    time_compacting: null,
    time_archived: null,
  }) as unknown as Parameters<typeof fromRow>[0]

describe("session origin", () => {
  test("AC-7 a valid metadata origin is on the session info", () => {
    const info = fromRow(row({ harnessInstanceID: "codex", origin: { sessionID: "ses_command", commandCentre: true } }))
    expect((info as { origin?: unknown }).origin).toEqual({ sessionID: "ses_command", commandCentre: true })
  })

  test("AC-7 no origin in metadata means none on the info", () => {
    const info = fromRow(row({ harnessInstanceID: "codex" }))
    expect((info as { origin?: unknown }).origin).toBeUndefined()
  })
})
