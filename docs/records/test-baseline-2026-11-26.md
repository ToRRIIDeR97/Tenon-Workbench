# Test baseline, 2026-11-26

A run of every existing suite on commit `e125392b`, before any phase of the
[mobile, thread sync and test pass programme](../../implementations/mobile-sync-programme/implementation.md)
changed code. Nothing was fixed; failures are listed with the
[feature test matrix](feature-test-matrix.md) ID they belong to.

Environment: Windows 11 Home 10.0.26200, Bun 1.3.14, Node.js 22.21.0 (`AGENTS.md` asks for Node.js 24;
only the desktop `node --test` step uses Node), Playwright Chromium already installed. Dependencies
were installed with `bun install --frozen-lockfile` in `tenon/` (2171 packages). Commands ran one at a
time, root scripts from the repository root.

| Command | Working directory | Result | Passed | Failed | Notes |
| --- | --- | --- | --- | --- | --- |
| `bun run typecheck` | repository root | pass | 17 | 0 | Counts are turbo tasks; all 17 were replayed from the local turbo cache for the same inputs |
| `bun run lint` | repository root | pass | | 0 | oxlint exits 0; it prints warnings only (mostly `no-unsafe-type-assertion`) |
| `bun run format:check` | repository root | pass | | 0 | All matched files use Prettier style |
| `bun run check:generated` | repository root | pass | | 0 | The generated client in `tenon/packages/client` is current. On Windows the regeneration rewrites nine generated files with LF line endings, which `git status` then shows as modified; they were restored with `git checkout` |
| `bun run test` | repository root | pass | 2840 | 0 | 12 turbo package tasks plus the Second Brain server tests (80 pass); 41 tests skipped |
| `bun run build` | repository root | pass | | 0 | Desktop build; Vite warns about chunks over 500 kB |
| `bun run test:engine` | repository root | fail | 1515 | 3 | `tenon/packages/core`: 1515 pass, 15 skip, 3 fail. The `&&` stops it there, so `tenon/packages/tenon` never ran; see the extra run below |
| `bun run test:routes` | repository root | pass | 11 | 0 | Three Playwright route specs, one worker |
| `bun run test:desktop` | repository root | pass | 259 | 0 | Bun: 254 pass, 6 skip. Node `draft-store.node-test.ts`: 6 tests, 5 pass and 1 skipped |
| `bun run test:app` | repository root | pass | 1532 | 0 | Unit 1471 pass, browser 61 pass |
| `bun run test:e2e` | `tenon/packages/app` | fail | 155 | 66 | 222 tests in 5.5 minutes, 1 skipped. Eight failures rerun alone with `--workers=1` failed the same way, so these are not load flakes |

Extra run, not one of the listed commands: `bun run --cwd tenon/packages/tenon test` (the half of
`test:engine` that did not run) gave 2974 pass, 57 skip, 2 fail across 211 files in 16 minutes.

## Failing tests

### `bun run test:engine` (`tenon/packages/core`)

| Matrix ID | Test | Cause seen |
| --- | --- | --- |
| F-1201 | `core/test/git.test.ts` › Git trees › diffs many files in one pass with the same result as per-file git diffs | `fs.symlink` fails with EPERM: Windows needs Developer Mode or admin rights to create symlinks |
| F-909 | `core/test/harness-setup.test.ts` › harness setup › stores one key per harness in a private file and bumps the revision | Expects file mode `0o600`; Windows reports `0o666`, as it has no POSIX modes |
| F-211 | `core/test/workspace-instructions.test.ts` › WorkspaceInstructions.resolve › an AGENTS.md symlinked outside the workspace is ignored | `fs.symlink` fails with EPERM, as above. F-1310 cites the same file |

### `tenon/packages/tenon` (extra run)

| Matrix ID | Test | Cause seen |
| --- | --- | --- |
| F-1604 | `tenon/test/server/httpapi-session.test.ts` › session HttpApi › returns v2 public unavailable errors for unfinished session mutations | `POST /api/session/:id/compact` answers 400, the test expects 503; compaction now exists, so the test looks stale |
| F-1012 | `tenon/test/tool/registry.test.ts` › tool.registry › preserves Zod arg descriptions from older config-scoped plugin packages | Timed out after 20 s, likely while installing the older plugin package |

### `bun run test:e2e`

| Matrix ID | Spec | Test |
| --- | --- | --- |
| F-223 | `e2e/acceptance/agent-writes.spec.ts` | AC-6.6 reduced motion shows the final note text at once |
| F-501 | `e2e/acceptance/command-centre.spec.ts` | AC-7.1 the rail's fourth destination is Command Centre and /activity redirects (the rail now also has `usage`) |
| F-508 | `e2e/acceptance/command-centre.spec.ts` | the card draws the reply as Markdown under a cap, with Show more |
| F-1206 | `e2e/acceptance/live-canvas-board.spec.ts` | AC-24 a board opened from history keeps every title whole |
| F-1206 | `e2e/acceptance/live-canvas-board.spec.ts` | AC-24 a design that arrives already finished leaves the board in view |
| F-1206 | `e2e/acceptance/live-canvas-follow.spec.ts` | AC-9 a canvas design from history never opens the panel |
| F-1204 | `e2e/acceptance/live-document.spec.ts` | AC-18 … AC-19 a write types into the Files tab live, then an edit flashes its block |
| F-1205 | `e2e/acceptance/live-tracked-edits.spec.ts` | AC-25 a streamed edit shows live, then Undo writes the original back |
| F-1205 | `e2e/acceptance/live-tracked-edits.spec.ts` | AC-25 Keep clears the highlight and writes nothing |
| F-401 | `e2e/acceptance/routines.spec.ts` | AC-9.5 the Routines page lists routines and Run now starts one |
| F-109 | `e2e/acceptance/sidebar-cards.spec.ts` | one highlight sits behind the selected row and moves with the selection |
| F-109 | `e2e/acceptance/sidebar-cards.spec.ts` | a row shows its state, idle shows nothing, and the sidebar no longer pulses |
| F-109 | `e2e/acceptance/sidebar-cards.spec.ts` | an approval on a child that was never listed moves its root to Needs you |
| F-108 | `e2e/acceptance/sidebar-s4.spec.ts` | AC-1.1 rail and panel share one outlined, neutral container |
| F-108 | `e2e/acceptance/sidebar-s4.spec.ts` | AC-1.2 toggling animates the container between rail-only and rail plus panel |
| F-108 | `e2e/acceptance/sidebar-s4.spec.ts` | AC-1.4 rail destinations keep their order and Settings opens the dialog |
| F-102 | `e2e/regression/brain-home-loading.spec.ts` | Home remains usable during loading and reuses fresh harness availability |
| F-104 | `e2e/regression/brain-home-model-picker.spec.ts` | Home starts a thread with the model and reasoning picked for its harness |
| F-216 | `e2e/regression/functional-audit-fixes.spec.ts` | notes preserve edits across navigation, search bodies, render headings and stable wiki links |
| F-106 | `e2e/regression/functional-audit-fixes.spec.ts` | Home opens the selected event, task and project; Today resets the displayed date |
| F-205 | `e2e/regression/functional-audit-fixes.spec.ts` | an archived Project restores from the Archived fold and its Pages open |
| F-1314 | `e2e/regression/functional-audit-fixes.spec.ts` | Spanish Brain navigation and harness names are localized |
| F-1307 | `e2e/regression/functional-audit-fixes.spec.ts` | blank server submission keeps its form and explains the missing address (two Add server buttons match) |
| F-901 | `e2e/regression/harness-picker-groups.spec.ts` | Harness picker lists the built-in loop first, then external agents, with an add action |
| F-103 | `e2e/regression/home-thread-composer.spec.ts` | Home shows the thread composer while the harness list is still being checked |
| F-610 | `e2e/regression/prompt-thinking-level.spec.ts` | shows the V2 thinking level control while relevant |
| F-1602 | `e2e/regression/remote-session-settings.spec.ts` | session settings use the remote server context |
| F-612 | `e2e/regression/session-request-docks.spec.ts` | shows a pending permission dock |
| F-708 | `e2e/regression/session-timeline-accessibility.spec.ts` | space activates a focused timeline button instead of scrolling |
| F-703 | `e2e/regression/session-timeline-collapse-state.spec.ts` | keeps a manually collapsed tool collapsed when later assistant content streams |
| F-703 | `e2e/regression/session-timeline-collapse-state.spec.ts` | does not remount an edit diff when sibling parts or diff counts update |
| F-703 | `e2e/regression/session-timeline-collapse-state.spec.ts` | keeps a sticky edit header aligned with a multi-hunk diff |
| F-704 | `e2e/regression/session-timeline-context-resize.spec.ts` | remeasures a recent explored context group before the next paint |
| F-704 | `e2e/regression/session-timeline-context-resize.spec.ts` | paints a stable exploring to explored transition |
| F-704 | `e2e/regression/session-timeline-context-state.spec.ts` | preserves a collapsed context group through count and status updates |
| F-705 | `e2e/regression/session-timeline-file-projection.spec.ts` | renders completed write content |
| F-705 | `e2e/regression/session-timeline-file-projection.spec.ts` | renders a completed single-file patch |
| F-705 | `e2e/regression/session-timeline-file-state.spec.ts` | updates edit diagnostics without resetting manual collapse state |
| F-705 | `e2e/regression/session-timeline-file-state.spec.ts` | preserves nested patch file state through outer collapse and reopen |
| F-706 | `e2e/regression/session-timeline-lifecycle-state.spec.ts` | preserves shell user intent from a collapsed default |
| F-706 | `e2e/regression/session-timeline-lifecycle-state.spec.ts` | preserves shell user intent from a expanded default |
| F-706 | `e2e/regression/session-timeline-lifecycle-state.spec.ts` | shows and expands a running shell command without shimmering it |
| F-708 | `e2e/regression/session-timeline-locale-projection.spec.ts` | projects translated context status in de |
| F-708 | `e2e/regression/session-timeline-locale-projection.spec.ts` | projects translated context status in ar |
| F-702 | `e2e/regression/session-timeline-projection.spec.ts` | renders every admitted tool family and hides timeline-only exclusions |
| F-702 | `e2e/regression/session-timeline-projection.spec.ts` | projects gaps, dividers, assistant parts, and errors together |
| F-706 | `e2e/regression/session-timeline-reasoning-projection.spec.ts` | projects busy reasoning profile summaries on visible reasoning |
| F-702 | `e2e/regression/session-timeline-reducer-projection.spec.ts` | groups singleton and separated context operations at correct boundaries |
| F-706 | `e2e/regression/session-timeline-shell-outline.spec.ts` | keeps the shell outline inside a fractionally short virtual row at 1.25x |
| F-706 | `e2e/regression/session-timeline-shell-outline.spec.ts` | keeps the shell outline inside a fractionally short virtual row at 1.5x |
| F-706 | `e2e/regression/session-timeline-shell-outline.spec.ts` | keeps the patch card inside a fractionally short virtual row |
| F-702 | `e2e/regression/session-timeline-tool-projection.spec.ts` | renders every tool error outcome without leaking hidden tools |
| F-702 | `e2e/regression/session-timeline-tool-projection.spec.ts` | transitions shell and question through running error outcomes |
| F-702 | `e2e/regression/session-timeline-tool-projection.spec.ts` | labels all web search provider variants |
| F-703 | `e2e/regression/session-timeline-tool-state.spec.ts` | updates expanded web search links without resetting expansion |
| F-703 | `e2e/regression/session-timeline-tool-state.spec.ts` | preserves an expanded tool error card across duplicate delivery |
| F-703 | `e2e/regression/session-timeline-tool-state.spec.ts` | renders multiple question answers and preserves open state on answer updates |
| F-709 | `e2e/regression/session-todo-dock-navigation.spec.ts` | animates todo lifecycle without replaying it across session tabs |
| F-1102 | `e2e/regression/terminal-composer-focus.spec.ts` | keeps composer focus when a cached terminal finishes mounting |
| F-1102 | `e2e/regression/terminal-composer-focus.spec.ts` | focuses a terminal created from the new-terminal button |
| F-1101 | `e2e/regression/terminal-tab-switch.spec.ts` | keeps the terminal alive across tabs on managed servers |
| F-1101 | `e2e/regression/terminal-tab-switch.spec.ts` | keeps the terminal alive across tabs on current servers |
| F-904 | `e2e/regression/terminal-tab-switch.spec.ts` | Codex exposes one effort selector and an independent service tier |
| F-701 | `e2e/smoke/session-timeline.spec.ts` | renders seeded timeline in order while paging through history |
| F-701 | `e2e/smoke/session-timeline.spec.ts` | expands an older turn's steps without jumping to the bottom |
| F-609 | `e2e/user-story/model-selection-flow.spec.ts` | opens a project from the sidebar, connects OpenCode Go, and selects its model in a new thread |

Spec paths are under `tenon/packages/app/`.

Added in P3b: `e2e/regression/remote-session-settings.spec.ts` › auto-accept responds for an unfocused server session also failed on the base commit (with `PLAYWRIGHT_SERVER_PORT` set) and was missed by the baseline run; its row is in [the app repair record](e2e-repair-2026-11-26-app.md).

Patterns in the e2e failures, for P3 to confirm:

- Most are `element(s) not found`, visibility or timeout errors: the specs look for markup that the
  current UI no longer renders (for example the rail now lists `usage`, the sidebar container lost its
  border), so the specs have drifted from the app.
- Both smoke tests fail only on console errors: `Failed to list terminals TypeError: result.data.forEach
  is not a function` from `tenon/packages/app/src/context/terminal.tsx`. The terminal list call gets a
  non-array from the mock server and the code does not guard it.
- Two failures are strict-mode locator clashes (two "Add server" buttons, two "General" buttons in the
  sidebar group).
