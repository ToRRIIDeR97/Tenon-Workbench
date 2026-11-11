# Feedback batch 1: contained fixes

Source: the 11 Nov 2026 feedback list. This batch takes the items with a clear,
local cause. Questions, design items and anything that needs a live
reproduction are answered in [`../../docs/product/FEEDBACK-2026-11-11.md`](../../docs/product/FEEDBACK-2026-11-11.md).

Run with TOR-1-Agent: one agent wrote the map, plan, tests and code. The tests
are not independent of the implementation.

## Feature map (causes found in code)

| Item | Cause |
| --- | --- |
| Skill text shows in chat | `submit.ts` builds the harness/v2 prompt `text` by joining every text part, including the synthetic skill instruction part. The v2 prompt has no hidden-part flag, so the skill body becomes the visible user message. |
| Duplicate skills in "/" | `HarnessSkills.scan` dedupes by file path only; one skill in `~/.claude/skills` and `~/.agents/skills` (both OpenCode roots) is listed twice. The composer list only dedupes Tenon vs harness names. |
| Added project missing from sidebar | `BrainProject.link` rescans, and the scan reuses an existing card for the folder. A folder that was removed before keeps its `archived` card, and the sidebar only lists `active` cards. |
| New thread ignores last model | `settings.harnesses.lastUsed` is written only when a new thread is sent. Changing harness or model in an existing thread never updates it. |
| Long model lists | The harness model step in the composer pill has no search (the built-in model dialog already has one). |
| Right panel opens on new threads | The review panel's open state is one global flag; opening it in any thread opens it in the next new thread. |
| No "open folder" for projects | The project menu has no reveal action; the preload already has `openPath`. |
| Instructions dialog error | Any failure shows "The request could not be completed" with no reason; the server's reasons (`outside_workspace`, `too_large`) are dropped. |
| Settings icons overlap / tabs | Tab headers pad 40px on the right while the dialog's close button sits 12px from the edge, so header actions (Refresh, Add) collide with it. Providers and Models are separate tabs. |
| Context "Used" = turn total | For an external harness without a live context report, `Used` falls back to the turn's summed token counts across every model call. |
| OpenCode Go "expired" while chats work | Usage for the built-in agent reads the key from the legacy `auth.json`; chats use the key in Tenon's credential store, which can be newer. |
| Short calendar events | Blocks under an hour drop the time; title and time should share one line. |

## Parts

| ID | Outcome | Criteria | Files | Depends |
| --- | --- | --- | --- | --- |
| P1 | Skill instructions reach every harness as a hidden text attachment; the visible message is only what the user typed. | AC-1 | `app/.../build-request-parts.ts`, `submit.ts`, `utils/skill-reference.ts` | – |
| P2 | Each skill name appears once in "/" and in the scan. | AC-2 | `utils/skill-reference.ts`, `prompt-input-v2.tsx`, `core/.../harness/skills.ts` | – |
| P3 | Re-adding a removed folder makes its Project active again. | AC-3 | `tenon/src/project/brain.ts` | – |
| P4 | A harness or model the user picks in any composer becomes the next new thread's choice. | AC-4 | `harness-controls.ts`, `prompt-input-v2.tsx` | – |
| P5 | The harness model list has a search box once it has more than 8 models. | AC-5 | `harness-controls.ts`, `model-pill.tsx` | – |
| P6 | Sending the first message of a new thread leaves the right panel closed. | AC-6 | `context/layout.tsx`, `submit.ts` | – |
| P7 | Project menu: "Open in Finder / File Explorer / file manager". | AC-7 | `second-brain-sidebar.tsx`, `i18n/en.ts` | – |
| P8 | Instructions dialog names the failure and has a cleaner layout. | AC-8 | `dialog-instructions.tsx`, `i18n/en.ts` | – |
| P9 | Settings: one "Built-in harness" tab (Providers / Models); header actions clear the close button. | AC-9 | `dialog-settings-v2.tsx`, `settings-v2.css`, `i18n/en.ts` | – |
| P10 | External-harness turns without a live report show Used as "Not reported", not the turn total. | AC-10 | `session-context-metrics.ts`, `context-strip.tsx` | – |
| P11 | OpenCode Go usage uses the stored credential first, then `auth.json`. | AC-11 | `core/.../harness/usage.ts`, `core/src/harness.ts` | – |
| P12 | Short calendar blocks show title and time on one line. | AC-12 | `calendar-grid.tsx` | – |
| P13 | Claude Code plan limits include a weekly Fable window. Added during verification. | AC-13 | `core/.../harness/usage.ts` | – |

## Acceptance criteria

- AC-1 `harnessPromptInput(parts)` puts no synthetic skill text in `text`; each skill becomes a `data:text/plain` file named `<skill> skill`; user text, file and agent parts are unchanged; quote/comment notes keep their current behaviour.
- AC-2 `pickerSkills` returns one entry per name, Tenon's first; `HarnessSkills.scan` returns one entry per name (nearest project scope wins over global).
- AC-3 link → unlink → link leaves the card `active`.
- AC-4 `rememberingHarness(controller, remember)` calls `remember` on `select` and `model.set` with the resulting choice, and passes calls through.
- AC-5 `filterHarnessModels(models, "")` returns all; a query matches name or id across separators; `searchableModelCount` is 8.
- AC-6 `layout.review.closePanel()` exists and the new-thread path calls it (inspection + typecheck).
- AC-7 Menu item present with the OS label (inspection + typecheck).
- AC-8 `instructionsErrorKey` maps `outside_workspace`, `too_large`, 404 and others to distinct strings.
- AC-9 Settings shows "Built-in harness" with Providers/Models; old `providers`/`models` deep links land there (inspection + typecheck).
- AC-10 `getSessionContext` sets `reported: false` for an external-harness message without `contextUsed`, and `true` for the built-in loop or a reported harness.
- AC-11 `openCodeGoKeyFrom(credentials)` prefers an `opencode-go` key credential, then `opencode`; `openCodeGoUsage` uses a given key before `auth.json`.
- AC-12 Short blocks render the time inline (inspection).
- AC-13 `parseClaudeUsage` reads `seven_day_fable` as "Weekly (Fable)" after the Sonnet window. The key name is an assumption until checked against a live Max/Ultra response.

Tests: acceptance and verification tests sit beside the code (`*.test.ts`),
listed in `acceptance/README.md` and `verification/README.md`. A frozen copy is
kept outside the repository.

## Completion evidence

Base `ae64b4f6`. Uncommitted on `claude/clarifications-fixes-needed-5ea1ff`.

Baseline: every new acceptance test failed before the change (app 8/8 fail,
core 3/3 fail, server "linking a folder again" fail with the card still
`archived`).

After the change:

- App: `bun run typecheck` clean; `bun run test:unit` 1042 pass, 0 fail.
- Core: `bun run typecheck` clean; `harness-feedback-batch`, `harness-usage`,
  `harness-skills` 42+ pass. Full core suite: 14 failures, all git timeouts
  (5 s) or Windows-only checks (symlink, file mode) in files this batch doesn't
  touch; the two non-git ones fail the same way on the unchanged main checkout.
- Server: `bun run typecheck` clean; full suite 2921 pass, 1 fail
  (`compaction` "stops quickly when aborted during retry backoff", which fails
  the same way on the unchanged main checkout).
- `bun run lint` exit 0 (warnings only); `bun run format:check` clean.
- Browser check (worktree dev servers, throwaway workspace): Built-in harness
  tab with Providers/Models; Instructions dialog layout and the "larger than
  256 KB" error; OpenCode's 439-model list with search ("deepseek flash" →
  10 matches); Home starts on the last picked model after a reload.
- Not run in the app: "Open in Finder/File Explorer" (desktop only; the web
  build hides it), the right-panel close on a new thread, the context
  "Not reported" state, the calendar block, P11 against a real OpenCode Go key.

Loop-backs: none to step 1. Found during verification and fixed: Home and the
Command Centre use a second model pill (`ComposerModelPill`) that P4 missed;
substring model search missed multi-word queries; legacy (v1) user messages
also joined synthetic parts into the visible text; "Customize" could overwrite
an unreadable project AGENTS.md.

Test changes after the freeze:

- `submit.test.ts` (existing test, not in the frozen set): its `useLayout` mock
  gained `review.closePanel`, the layout API P6 adds. No assertion changed.
- Prettier re-wrapped two lines in the frozen tests; assertions unchanged.
- AC-13 test added after the freeze for P13, run failing first, then frozen.

One agent wrote the plan, tests and code (TOR-1), so the verification tests
are not independent.
