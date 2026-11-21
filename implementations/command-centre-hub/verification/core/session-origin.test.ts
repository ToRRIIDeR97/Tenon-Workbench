// Run from tenon/packages/core: bun test ../../../Implementations/command-centre-hub/verification/core
import { expect, test } from "bun:test"
import { fromRow } from "../../../../tenon/packages/core/src/session/info"

const row = (metadata: unknown) =>
  ({
    id: "ses_x", project_id: "prj_x", workspace_id: null, parent_id: "ses_parent", slug: "s", directory: "/w", path: null,
    title: "t", version: "1", share_url: null, summary_additions: null, summary_deletions: null, summary_files: null,
    summary_diffs: null, metadata, cost: 0, tokens_input: 0, tokens_output: 0, tokens_reasoning: 0, tokens_cache_read: 0,
    tokens_cache_write: 0, revert: null, permission: null, agent: null, model: null, time_created: 1, time_updated: 1,
    time_compacting: null, time_archived: null,
  }) as unknown as Parameters<typeof fromRow>[0]
const origin = (metadata: unknown) => (fromRow(row(metadata)) as { origin?: unknown }).origin

test("AC-7 malformed origins are dropped", () => {
  expect(origin({ origin: { sessionID: 42, commandCentre: true } })).toBeUndefined()
  expect(origin({ origin: { sessionID: "ses_a" } })).toBeUndefined()
  expect(origin({ origin: "ses_a" })).toBeUndefined()
  expect(origin(null)).toBeUndefined()
})

test("AC-7 a Project thread's origin keeps commandCentre false, next to a parent link", () => {
  expect(origin({ origin: { sessionID: "ses_a", commandCentre: false } })).toEqual({ sessionID: "ses_a", commandCentre: false })
})
