# End-to-end repair, thread view, 2026-11-26

Part P3a of the [mobile, thread sync and test pass programme](../../implementations/mobile-sync-programme/implementation.md):
the 39 thread-view failures of the [test baseline](test-baseline-2026-11-26.md) (`bun run test:e2e`
table), each decided as `spec drifted`, `app regressed` or `feature removed`. Base commit `57ec14e9`.
Every Playwright run used `PLAYWRIGHT_PORT=3101 PLAYWRIGHT_SERVER_PORT=4101`.

## Shared causes

- **Steps live in the Worked card.** Since `426d9a31` (feat(app): draw the Worked card's steps inside it,
  with a reasoning ticker) the thread folds every tool and reasoning part of a normal turn into the
  `TurnSteps` card: `message-timeline.tsx` passes `folded: () => true`, so the `AssistantPart` rows that drew
  session-ui's tool renderers (`collapsible-trigger`, `edit-content`, `write-content`, `bash-output`,
  `tool-error-card`, the "Ran N tools" and "Explored" groups) never reach the thread; only shell turns
  (`!` commands) still use them. `TurnStepsSummary` draws each step as a row
  (`[data-slot="turn-steps-item"][data-timeline-part-id]` holding a `turn-steps-row` button and a
  `turn-steps-detail` reveal), merges consecutive reads, searches, edits, commands and fetches into one
  group row, and shows reasoning as `turn-steps-note`. `docs/architecture/README.md` ("Opened, the card
  draws the steps itself") and `docs/product/NAVIGATION-MAP-V1.md` (Thread) describe it, and `9c94f3b3`
  (test(app): … specs for steps in the Worked card) already moved six stability specs to the card. Most
  rows below are this cause. The timeline fixture gained two helpers, `turnStep` and `turnStepGroup`
  (`e2e/performance/timeline-stability/fixture.ts`), so the specs find a step and a group row the same way.
- **The terminal list answer was not guarded.** The mock server answers `GET /api/pty` with `{}`, and
  `context/terminal.tsx` called `result.data.forEach`, logging `Failed to list terminals`, which fails the
  smoke specs' console check. `listedTerminals` now reads any non-array answer as no terminals
  (AC-P3-4, unit test `src/context/terminal-list.test.ts`).
- **Per-thread terminals.** `eea39920` (feat(app,tenon): per-thread terminal tabs and agent terminals) made
  the panel toggle and tabs per thread, stored under new keys, and lists a thread's terminals on load. The
  terminal specs seeded the old folder-wide keys, expected another thread to show the same terminal, and
  counted the new list request as a terminal creation (two "Terminal 2" tabs).

## Decisions

| Spec | Test | Decision | Evidence | Change |
| --- | --- | --- | --- | --- |
| `e2e/regression/prompt-thinking-level.spec.ts` | shows the V2 thinking level control while relevant | spec drifted | `ace3635f` (feat(composer): split model pill with the reasoning level always shown): the level is its own button named "Reasoning: {level}"; `docs/design.md` | `e2e/regression/prompt-thinking-level.spec.ts` (finds the "Reasoning: …" button, asserts Default before and high after the pick) |
| `e2e/regression/session-request-docks.spec.ts` | shows a pending permission dock | spec drifted | `b1548fdf` (fix(app): UI/UX polish from a headless walk-through): "joined split buttons with chevrons, deny reason behind Deny's menu", so Deny and Allow once each have a menu button | `e2e/regression/session-request-docks.spec.ts` (four named buttons: Deny, More ways to deny, Allow once, More ways to allow) |
| `e2e/regression/session-timeline-accessibility.spec.ts` | space activates a focused timeline button instead of scrolling | spec drifted | `426d9a31`; the shell is a `turn-steps-row` button in the card | `e2e/regression/session-timeline-accessibility.spec.ts`, `e2e/performance/timeline-stability/fixture.ts` |
| `e2e/regression/session-timeline-collapse-state.spec.ts` | keeps a manually collapsed tool collapsed when later assistant content streams | spec drifted | `426d9a31`; the edit is a step row in the `TurnSteps` row, not an `AssistantPart` row | `e2e/regression/session-timeline-collapse-state.spec.ts`, `e2e/performance/timeline-stability/fixture.ts` |
| `e2e/regression/session-timeline-collapse-state.spec.ts` | does not remount an edit diff when sibling parts or diff counts update | app regressed | With the row key corrected to `turn-steps:msg_user_regression:0` the probe still found the step, row and frame kept but the diff's file component rebuilt (its marker gone, one new shadow root) when a text part arrived, and again when only the diff counts changed. `TurnStepsSummary` (since `426d9a31`) rendered `<For each={diffs()}>` and `editDiffs` returns new objects on every recompute, so every update remounted the diff | `tenon/packages/app/src/components/session/turn-steps-summary.tsx` (diffs memo compared by content with `sameDiffs`, `Index` over the diffs, and the file view's `fileDiff` held by `sameFileDiff`, so a count change updates the counts without rebuilding the view), `tenon/packages/app/src/components/session/turn-steps-summary.test.ts`, `e2e/regression/session-timeline-collapse-state.spec.ts` (card locators and row key) |
| `e2e/regression/session-timeline-collapse-state.spec.ts` | keeps a sticky edit header aligned with a multi-hunk diff | feature removed | Removed by `426d9a31` (feat(app): draw the Worked card's steps inside it …), which added `folded: () => true` to `message-timeline.tsx`: the sticky header is session-ui's `StickyAccordionHeader` in the edit tool part (`message-part.tsx`), drawn only for unfolded `AssistantPart` rows. Nothing equivalent remains to test because the card shows an edit's diff inside its own `ScrollView` capped at `max-h-96`, so the timeline never scrolls past a long diff and no header needs to stick (`turn-steps-summary.tsx`, `turn-steps-summary.css` have no sticky element) | `e2e/regression/session-timeline-collapse-state.spec.ts` (test deleted) |
| `e2e/regression/session-timeline-context-resize.spec.ts` | remeasures a recent explored context group before the next paint | spec drifted | `426d9a31`; the read-only run is now the turn's Worked card ("Read 1 file", "Searched 3 times"), folded once text follows it | `e2e/regression/session-timeline-context-resize.spec.ts` (opens the folded card at the bottom and samples overlap with the following text each frame) |
| `e2e/regression/session-timeline-context-resize.spec.ts` | paints a stable exploring to explored transition | feature removed | Removed by `426d9a31`, which folds every step row of a normal turn (`folded: () => true`): the "Exploring"/"Explored" status title (`tool-status-title`) belongs to session-ui's context group. Nothing equivalent remains to test because the card has no status title that changes as reads finish: its group row is named by a fixed count phrase (`secondBrain.turnSteps.search`), and only a running dot comes and goes, which `session-timeline-context-state.spec.ts` already asserts | `e2e/regression/session-timeline-context-resize.spec.ts` (test deleted) |
| `e2e/regression/session-timeline-context-state.spec.ts` | preserves a collapsed context group through count and status updates | spec drifted | `426d9a31` and `docs/architecture/README.md`: consecutive searches merge into one group row named by the count phrase | `e2e/regression/session-timeline-context-state.spec.ts` (a "Searched 2 times" group stays closed while its steps finish and a third arrives) |
| `e2e/regression/session-timeline-file-projection.spec.ts` | renders completed write content | spec drifted | `426d9a31`; a write opens to its diff (`editDiffs` builds it from the content) | `e2e/regression/session-timeline-file-projection.spec.ts` |
| `e2e/regression/session-timeline-file-projection.spec.ts` | renders a completed single-file patch | spec drifted | `426d9a31`; a patch opens to one diff per file from `metadata.files` | `e2e/regression/session-timeline-file-projection.spec.ts` |
| `e2e/regression/session-timeline-file-state.spec.ts` | updates edit diagnostics without resetting manual collapse state | spec drifted | `426d9a31`; `9c94f3b3` made the card honour Expand edit tool parts | `e2e/regression/session-timeline-file-state.spec.ts` |
| `e2e/regression/session-timeline-file-state.spec.ts` | preserves nested patch file state through outer collapse and reopen | spec drifted | `426d9a31`; the patch step's open state now nests inside the Worked card, which is the outer collapse | `e2e/regression/session-timeline-file-state.spec.ts` (opens the patch step, folds and reopens the card, the step stays open with its three diffs) |
| `e2e/regression/session-timeline-lifecycle-state.spec.ts` | preserves shell user intent from a collapsed default | spec drifted | `426d9a31`, `9c94f3b3` (the card honours Expand shell tool parts) | `e2e/regression/session-timeline-lifecycle-state.spec.ts` |
| `e2e/regression/session-timeline-lifecycle-state.spec.ts` | preserves shell user intent from a expanded default | spec drifted | as above | `e2e/regression/session-timeline-lifecycle-state.spec.ts` |
| `e2e/regression/session-timeline-lifecycle-state.spec.ts` | shows and expands a running shell command without shimmering it | spec drifted | `426d9a31` and `docs/architecture/README.md` ("the header title … shimmer"): the working card's title shimmers, the step row shows the command plainly | `e2e/regression/session-timeline-lifecycle-state.spec.ts` |
| `e2e/regression/session-timeline-locale-projection.spec.ts` | projects translated context status in de | feature removed | Removed by `426d9a31`, which folds every step row of a normal turn (`folded: () => true`): the asserted "Erkundung abgeschlossen" is `ui.sessionTurn.status.gatheredContext`, drawn only by session-ui's context group. Nothing equivalent remains to test because the card's text for these steps comes from keys that exist in `en.ts` only (title `secondBrain.turnSteps.worked`, count phrases `secondBrain.turnSteps.read` and `secondBrain.turnSteps.search`, row verbs `secondBrain.step.read` and `secondBrain.step.searched`; `de.ts` has none of them), and that is the stated policy: `docs/design.md` (Text) says "new `secondBrain.*` keys may be English-only" and `src/i18n/parity.test.ts` exempts the `secondBrain.` prefix (`englishFallbackPrefixes`). The only translated piece, the duration (`ui.message.duration.seconds`), is the same "1s" in German | `e2e/regression/session-timeline-locale-projection.spec.ts` (file deleted) |
| `e2e/regression/session-timeline-locale-projection.spec.ts` | projects translated context status in ar | feature removed | Removed by `426d9a31` as in the de row: the asserted "تم الاستكشاف" (`ui.sessionTurn.status.gatheredContext`) belongs to the folded context group. Nothing equivalent remains to test because the card's step and status keys (`secondBrain.turnSteps.*`, `secondBrain.step.*`) are absent from `ar.ts` by the policy in `docs/design.md` and `parity.test.ts`; only the duration (`ui.message.duration.seconds`, "{{count}}ث") is translated, and asserting it alone would not test a context status | `e2e/regression/session-timeline-locale-projection.spec.ts` (file deleted) |
| `e2e/regression/session-timeline-projection.spec.ts` | renders every admitted tool family and hides timeline-only exclusions | spec drifted | `426d9a31`; the card groups "Searched 3 times", "Edited 2 files", "Fetched 2 pages", lists the rest alone and hides `todowrite` (`HIDDEN_TOOLS`) | `e2e/regression/session-timeline-projection.spec.ts`, `e2e/performance/timeline-stability/fixture.ts` |
| `e2e/regression/session-timeline-projection.spec.ts` | projects gaps, dividers, assistant parts, and errors together | spec drifted | `ba612654` (feat(app): UI/UX audit refinements …, "the UI says thread throughout"): `ui.messagePart.compaction` is "Thread compacted" | `e2e/regression/session-timeline-projection.spec.ts` |
| `e2e/regression/session-timeline-reasoning-projection.spec.ts` | projects busy reasoning profile summaries on visible reasoning | spec drifted | `426d9a31`; visible reasoning is a `turn-steps-note` in the card | `e2e/regression/session-timeline-reasoning-projection.spec.ts` |
| `e2e/regression/session-timeline-reducer-projection.spec.ts` | groups singleton and separated context operations at correct boundaries | spec drifted | `426d9a31` and `docs/architecture/README.md` ("Text … end the run, so … the steps after it start a new card") | `e2e/regression/session-timeline-reducer-projection.spec.ts` (two cards split by the text, a "Searched 2 times" group, the shell and the list in order) |
| `e2e/regression/session-timeline-shell-outline.spec.ts` | keeps the shell outline inside a fractionally short virtual row at 1.25x | spec drifted | `426d9a31`; the framed surface in the row is now the Worked card (`bash-output` is not drawn), and the row's `overflow-clip-margin` must still keep its edge painted | `e2e/regression/session-timeline-shell-outline.spec.ts` |
| `e2e/regression/session-timeline-shell-outline.spec.ts` | keeps the shell outline inside a fractionally short virtual row at 1.5x | spec drifted | as above | `e2e/regression/session-timeline-shell-outline.spec.ts` |
| `e2e/regression/session-timeline-shell-outline.spec.ts` | keeps the patch card inside a fractionally short virtual row | spec drifted | as above (the `apply-patch` accordion is not drawn) | `e2e/regression/session-timeline-shell-outline.spec.ts` |
| `e2e/regression/session-timeline-tool-projection.spec.ts` | renders every tool error outcome without leaking hidden tools | app regressed | The spec counts a dismissed question apart from tool errors. The card counted "The user dismissed this question" as a failed step (red, "N steps failed", keeps the card open), although `a057c7ef` made "declined tool calls and user stops neutral, not failed" and core reports a dismissed question as declined (`core/test/harness-ask-user.test.ts`, "reports a dismissed question as declined") | `tenon/packages/session-ui/src/components/step-kind.ts` (`isDeclined` matches the dismissal), `tenon/packages/session-ui/src/components/step-kind.test.ts`, `e2e/regression/session-timeline-tool-projection.spec.ts` (card locators: "10 steps failed", "1 declined", each error's text) |
| `e2e/regression/session-timeline-tool-projection.spec.ts` | transitions shell and question through running error outcomes | app regressed | Once the question turns visible (it is hidden while pending or running) it sorts before the shell (`prt_transition_error_question` < `prt_transition_error_shell`), and the card then shows the shell twice and no question. `TurnStepsSummary` (since `426d9a31`) rendered `<Index each={runs()}>` with `untrack(() => stepRow(run()[0], index))`, so slot 0 kept the part it was created with. Temporarily renaming the question so it sorts last made the test pass, which confirmed the cause; the committed spec keeps the original IDs. In real use this hits parallel tool calls where a question is answered after a later tool | `tenon/packages/app/src/components/session/turn-steps-summary.tsx` (runs and a group's steps are keyed by part ID with `For` over `stepKeys`, and each row reads its current part through an accessor), `tenon/packages/app/src/components/session/turn-steps-summary.test.ts`, `e2e/regression/session-timeline-tool-projection.spec.ts` (card locators; also checks the shell row's DOM node is kept and the rows read question then shell) |
| `e2e/regression/session-timeline-tool-projection.spec.ts` | labels all web search provider variants | feature removed | Removed by `426d9a31`, which folds every step row of a normal turn (`folded: () => true`): the provider labels ("Parallel Web Search", "Exa Web Search") come from session-ui's websearch tool part. Nothing equivalent remains to test because the card never reads `metadata.provider`: every web search is labelled by its kind ("Fetched", `stepVerbKey`) and its query (`stepOf` in `step-kind.ts`), the same for every provider | `e2e/regression/session-timeline-tool-projection.spec.ts` (test deleted) |
| `e2e/regression/session-timeline-tool-state.spec.ts` | updates expanded web search links without resetting expansion | spec drifted | `426d9a31`; a step opens to its text output (`toolDetail`), so the links are output lines, not anchors | `e2e/regression/session-timeline-tool-state.spec.ts` |
| `e2e/regression/session-timeline-tool-state.spec.ts` | preserves an expanded tool error card across duplicate delivery | spec drifted | `426d9a31`; a failed step opens to its error | `e2e/regression/session-timeline-tool-state.spec.ts` |
| `e2e/regression/session-timeline-tool-state.spec.ts` | renders multiple question answers and preserves open state on answer updates | spec drifted | `426d9a31`; the question step opens to the tool's output, which carries the answers (format from `tenon/packages/tenon/src/tool/question.ts`) | `e2e/regression/session-timeline-tool-state.spec.ts` |
| `e2e/regression/session-todo-dock-navigation.spec.ts` | animates todo lifecycle without replaying it across session tabs | app regressed | Two causes. Drift: `1be9a999` and `47ad0bc1` moved the fade to the dock element, so the spec sampled a removed label span. Regression: `47ad0bc1` (feat(app): checklist in the composer tray …) changed the dock's unmeasured height from 78 to one row, and the measurement runs before the dock is laid out, so returning to the thread painted the open list clipped to 36 px for a frame (samples 36, then 128), which is the replay the test forbids | `tenon/packages/app/src/pages/session/composer/session-todo-dock.tsx` (no clip until measured, `todoDockMaxHeight`), `tenon/packages/app/src/pages/session/composer/session-todo-dock.test.ts`, `e2e/regression/session-todo-dock-navigation.spec.ts` |
| `e2e/regression/terminal-composer-focus.spec.ts` | keeps composer focus when a cached terminal finishes mounting | spec drifted | `eea39920`: tabs and the open panel are stored per thread, so the seeded folder keys (`terminal.v1`, `layout.terminal.opened`) restore nothing; the list request on load also counted as a creation | `e2e/regression/terminal-composer-focus.spec.ts` (opens a terminal, reloads with the terminal module held, counts only `POST` as a creation) |
| `e2e/regression/terminal-composer-focus.spec.ts` | focuses a terminal created from the new-terminal button | spec drifted | `eea39920` lists the thread's terminals on load; the spec's route counted that `GET` as the first creation, so both later creations returned "Terminal 2" and two tabs had the same name | `e2e/regression/terminal-composer-focus.spec.ts` (list answers `[]`, only `POST` creates) |
| `e2e/regression/terminal-tab-switch.spec.ts` | keeps the terminal alive across tabs on managed servers | spec drifted | `eea39920` and `docs/architecture/README.md` (Thread terminals): each thread has its own tabs and panel toggle, so another thread shows no terminal; returning remounts the panel and resumes the same PTY at its cursor (`cursor=20`) without creating one | `e2e/regression/terminal-tab-switch.spec.ts` |
| `e2e/regression/terminal-tab-switch.spec.ts` | keeps the terminal alive across tabs on current servers | spec drifted | as above | `e2e/regression/terminal-tab-switch.spec.ts` |
| `e2e/regression/terminal-tab-switch.spec.ts` | Codex exposes one effort selector and an independent service tier | spec drifted | `ba612654` ("Home keeps its plain box … moves the text to the full composer on a draft"): on the new-thread page the `data-action="prompt-model-pill"` button belongs to the hidden full composer, so the click waited forever on an invisible element; the visible pill is the plain box's, named "Model: …" (`ace3635f`) | `e2e/regression/terminal-tab-switch.spec.ts` (finds the visible "Model: …" button) |
| `e2e/smoke/session-timeline.spec.ts` | renders seeded timeline in order while paging through history | app regressed | Console error `Failed to list terminals TypeError: result.data.forEach is not a function`: `context/terminal.tsx` used the list answer without checking it is an array | `tenon/packages/app/src/context/terminal.tsx` (`listedTerminals`), `tenon/packages/app/src/context/terminal-list.test.ts` |
| `e2e/smoke/session-timeline.spec.ts` | expands an older turn's steps without jumping to the bottom | app regressed | Same console error. With it fixed the spec also met the card (`426d9a31`): the turn has two cards, so its `TurnSteps … button` locator matched two buttons, and the shell is a card step | `tenon/packages/app/src/context/terminal.tsx`, `tenon/packages/app/src/context/terminal-list.test.ts`, `e2e/smoke/session-timeline.spec.ts` (opens the card that holds the command, toggles the shell step, checks the view did not jump to the bottom) |

Counts: 28 `spec drifted`, 6 `app regressed`, 5 `feature removed`.

No timeout was raised and no `.skip`, `.fixme` or `.only` was added.

## The Worked card fix

`turn-steps-summary.tsx` had two keying faults, both from `426d9a31`:

- Steps were rendered with `Index` and each slot captured its part once (`untrack(() => stepRow(run()[0],
  index))`), so a slot showed the part it was created with even after the list changed under it. Runs
  and a group's steps are now rendered with `For` over their part IDs (`stepKeys`), each row reads its
  current part through an accessor, and a new step that sorts earlier gets a new row while the existing
  rows keep their DOM nodes.
- An edit step's diffs were rendered with `For` over objects that `editDiffs` rebuilds on every recompute,
  so any update rebuilt the diff view. The diffs memo now compares by content (`sameDiffs`), the list is an
  `Index`, and the view's `fileDiff` is held while its content is unchanged (`sameFileDiff`), so a count
  change updates the counts and keeps the view.

Evidence that the fix adds no re-rendering: `session-timeline-collapse-state.spec.ts` marks the step, the
diff's file element, the virtual row and the frame, then checks all keep their markers and no new shadow
root is attached across a sibling text part and a diff-count update; `session-timeline-tool-projection.spec.ts`
marks the shell row and checks the same node is still there after the question appears before it. Unit
tests for `stepKeys`, `sameDiffs` and `sameFileDiff` are in `turn-steps-summary.test.ts`.

## Benchmark

`tenon/packages/app/AGENTS.md` asks for a production benchmark before and after a session or timeline
change.

- With default settings the scenario does not run on the base commit: `bunx playwright test --config
  e2e/performance/playwright.config.ts timeline/session-timeline-benchmark.spec.ts` (port 3101) built the
  production bundle, then the first scenario, "streams assistant text without remounting or oscillating",
  timed out after 420 s in `page.waitForFunction` waiting for the last of 160 deltas at the default 30x CPU
  throttle, with no metrics.
- With that one scenario at a lighter profile it runs in about 45 s:
  `TIMELINE_CPU_THROTTLE=4 TIMELINE_DELTA_COUNT=40 TIMELINE_COMPLETION_TIMEOUT_MS=600000 bunx playwright test
  --config e2e/performance/playwright.config.ts timeline/session-timeline-benchmark.spec.ts -g "streams
  assistant text without remounting"` with `PLAYWRIGHT_PORT=3101 PLAYWRIGHT_WORKERS=1`. "Before" is
  `turn-steps-summary.tsx` at `3c5cf27c`; "after" is the fix. Three runs each:

| Metric | Before | After |
| --- | --- | --- |
| initial content observed (ms) | 236, 500, 1021 | 895, 994, 1006 |
| completion observed (ms) | 8088, 8149, 7976 | 7809, 8800, 8147 |
| rAF gap p95 (ms) | 16.8, 16.8, 16.8 | 16.8, 16.8, 16.8 |
| rAF gap p99 (ms) | 49.9, 16.8, 16.8 | 33.3, 50.0, 16.8 |
| long task time (ms) | 218, 131, 173 | 127, 231, 112 |
| row or markdown replaced | no, no, no | no, no, no |

The ranges overlap on every metric (initial content spreads from 236 to 1021 ms before the change alone),
so this scenario shows no difference. It streams assistant text into a long history and opens no step,
so it does not exercise opened steps; the spec-level node checks above are the evidence for those.

