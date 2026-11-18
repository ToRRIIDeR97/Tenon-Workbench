# Harness UX batch 2: issues from 18 Nov 2026

Run with TOR-1-Agent: one agent wrote the map, plan, tests and code. The tests
are not independent of the implementation. A panel of three reviewers scores
the result afterwards.

## Feature map (causes found in code and in the dev database)

| # | Issue | Cause |
| --- | --- | --- |
| 1 | Home shows "Checking harnesses…" until a tab swap | Home's model pill (`ComposerModelPill`) reads a TanStack query inside a `Suspense` whose fallback is "Checking harnesses…". With nothing remembered yet (first launch) the read suspends; a first check that fails while the server starts is retried 10 times, then the query rests in error and the fallback never leaves. Remounting (tab swap) refetches. The thread composer uses `createPromptHarnessController`, which never suspends and keeps a persisted list. |
| 2 | Switching harness feels like a restart | (a) The new harness's model list is empty until its agent answers, so the pill shows "Loading models…" and no model. (b) Switching picks the harness's default model, not the one last used with it. (c) In a thread the pill shows the old harness until `POST /session/:id/harness` returns, the pill is disabled meanwhile, and sending during the switch is refused with a "switching" toast. The server side only publishes an event; it does not start the agent. |
| 3 | Home's composer is not the thread composer | Home renders `ComposerBox` (plain textarea, no attachments, skills, history, `@`/`/`); drafts and threads render `PromptInputV2Composer`. |
| 4 | Running state has no breathing blue dot | The thread's "Working" row shows a spinner (`LoaderV2`); the sidebar's running mark is a static dot; `.running-pulse` is an expanding ring. |
| 5 | A finished thread doesn't say whether it is done or waiting | `ThreadState` has only `approval`, `running`, `idle`. The notification store already records unseen `turn-complete`/`error` per session, but the sidebar ignores it; nothing records whether the agent ended by asking the user something. |
| 6 | Dictation: no live words; sometimes translates | The engine records, then transcribes once on stop (`final` only). Whisper runs with `language: None` (auto-detect per clip); a mis-detected language makes Whisper answer in another language (reads as a translation). |
| 7 | Todo list doesn't show | OpenCode over ACP reports its `todowrite` as a `tool_call` of kind `other`, which Tenon names `acp_other` (the dev DB has `acp_other` calls with `title: "todowrite"` and a `todos` input, and an empty `todo` table). The runner only saves plans from calls named `todowrite`. |
| 8 | Thread is named at the end | `SessionRunner.run` starts the title with `Effect.ensuring(startTitle)` around the first turn, so it starts only when that turn ends. |
| 9 | Context "Used" not reported for OpenCode | OpenCode 2.2.5 sends `usage_update` once, at turn end (checked in its binary; finished turns in the dev DB carry `contextUsed`). While a turn runs, the newest assistant message has tokens but no live report, so Used reads "Not reported". |
| 10 | Agenda lists days that have passed (added mid-run) | The calendar's `schedule` memo uses `{ start: "", end: "9999-12-31" }` for the agenda, so every past event and open task is listed. |
| 11 | Subagent and tool rows all refresh together (added mid-run) | Any subagent's progress rebuilds every lane's steps (`subagentLanes` reads all parts), and each lane keys its "doing now" line on the step object (`<Show keyed>`), so every lane remounts and replays its entry motion at once. |
| 12 | Writing your own answer draws a blue box (added mid-run) | The question dock's custom-answer `<textarea>` has its own `:focus-visible` 2px outline with a 2px offset, inside an option card that is already highlighted; a focused textarea always matches `:focus-visible`. |
| 13 | Token use shown as context in use (added mid-run) | A running OpenCode turn showed "Used 528,890 of 200,000 (264%)", the same figure as the turn's token total. The meter accepted any `contextUsed`, and any summed figure, even above the window. The exact source of that live value wasn't reproduced (the dev DB has no figure for the running turn); the fix rests on the invariant that context in use can't exceed the window. |
| 14 | Environment window lists every subagent; a title doesn't take you anywhere (added mid-run) | Its Running section listed all subagents, finished ones included. A row did open the side panel's Agents tab, but the window stayed open on top, so the click looked like it did nothing. |
| 15 | Stutter after the window was minimized or a page wasn't opened for a while (added mid-run) | The main window keeps Electron's default background throttling: a page hidden for a while gets its timers about once a minute. The live event stream yields and flushes on `setTimeout`, so events pile up while minimized and are applied in one burst on return. Also, the stream starts inside a `requestAnimationFrame`, which doesn't run in a hidden window. "A page not opened in a while" wasn't profiled. |
| 16 | Tool calls jitter when opened without room (added mid-run, screen recording) | Frames from the recording: the expanding card and the thread jump while it grows. `keepInPlace` corrected scroll drift from `requestAnimationFrame`, which runs before the frame's layout, so each correction was one frame late, worst near the end of the thread where scrolling is clamped. |
| 17 | Opening the right sidebar is laggy (added mid-run, screen recording) | Frames from the recording show the thread text re-wrapping at a new width every frame: the thread column eased its `width` for 300 ms, re-laying out the whole timeline each frame. |
| 18 | The Canvas button shows on the right rail only while the agent draws (added mid-run) | `session-side-rail.tsx` rendered it only when a canvas tab was open. |
| 19 | A canvas window scrolls with the browser's default scrollbar (added mid-run) | The design frame is its own document (`designDocument`), which never gets the app's scrollbar styles. |

## Change diagrams

- [Current vs proposed](diagrams/change.svg)

## Parts

| ID | Outcome | Criteria | Files | Depends |
| --- | --- | --- | --- | --- |
| P1 | Harness lists never stick on "Checking harnesses…": no suspending read; a failed check keeps retrying (fast, then every 15 s). | AC-1 | `prompt-input/harness-controller.ts`, `prompt-input/composer-harness.tsx` | – |
| P2 | Switching harness is invisible: remembered models show at once, the last model used with that harness is picked, the thread pill follows the pick immediately and stays usable, and a send during a switch waits for it. | AC-2 | `prompt-input/harness-controller.ts`, `prompt-input/harness-switch.ts`, `prompt-input/submit.ts`, `pages/session.tsx` | – |
| P3 | Home renders the thread composer (`PromptInputV2Composer`) through the same draft controller as a new thread. | AC-3 | `pages/home/home-composer.tsx`, `pages/brain-home.tsx`, `app.tsx` | P1 |
| P4 | Running is a blue dot that breathes in and out, in the thread's Working row, the sidebar and Home. | AC-4 | `index.css`, `turn-steps-summary.tsx`, `second-brain-sidebar.tsx` | – |
| P5 | A finished thread shows Done, Needs your reply, or Failed in the sidebar until opened. | AC-5 | `features/second-brain/thread-finish.ts`, `context/notification.tsx`, `sidebar-controller.ts`, `second-brain-sidebar.tsx` | P4 |
| P6 | Dictation shows words while recording, and transcribes in the chosen spoken language (default: the app's language) instead of guessing per clip. Variants workshopped. | AC-6 | `dictation/src/*`, `desktop/src/main/dictation*.ts`, preload, `context/platform.tsx`, `dictation-button.tsx`, settings | – |
| P7 | OpenCode plans fill the thread's todo list. | AC-7 | `core/src/session/todo.ts`, `core/src/session/runner/llm.ts` | – |
| P8 | A new thread is titled as soon as its first message is taken, while the turn runs. | AC-8 | `core/src/session/runner/llm.ts` | – |
| P9 | During a running OpenCode turn, Used shows the context at the end of the previous turn instead of "Not reported". | AC-9 | `components/session/session-context-metrics.ts` | – |
| P10 | The agenda starts today; overdue open tasks show under today. | AC-10 | `features/second-brain/calendar-domain.ts`, `pages/calendar.tsx` | – |
| P11 | A subagent lane's "doing now" line changes only when that lane's step changes. | AC-11 | `components/session/subagent-lane.tsx` | – |
| P12 | The custom-answer field has no inner ring; the option card's edge becomes a soft accent hairline while typing. Variants workshopped. | AC-12 | `session-ui/src/components/message-part.css` | – |
| P14 | The Environment window lists only running subagents, with All subagents for the rest; a row or that link opens the Agents tab and closes the window. | AC-14 | `environment-model.ts`, `thread-environment.tsx` | – |
| P15 | The Canvas button is always on the rail. | AC-15 | `session-side-rail.tsx`, `session.tsx` | – |
| P16 | Canvas frames use the app's pill scrollbar. | AC-16 | `session-ui/.../design-fence.ts` | – |
| P17 | Hidden-window event work runs as message-channel tasks; a hidden load starts the stream at once. | AC-17 | `utils/unthrottled-task.ts`, `context/server-sdk.tsx`, `context/server-sync.tsx` | – |
| P18 | Expanding a card corrects scroll drift in a `ResizeObserver` (same frame) as well as per frame. | – (live check not possible in a hidden pane; inspection) | `turn-steps-summary.tsx` | – |
| P19 | The thread column steps to its new width; the panel slides out of the rail at the right edge; closing widens the column once after the slide. | – (live width sampling) | `pages/session.tsx` | – |
| P13 | A context figure above the window is never shown as Used; the last real report stands in. | AC-13 | `components/session/session-context-metrics.ts` | P9 |

## Acceptance criteria

- AC-1 `harnessRetryDelay(n)` is 3000 ms for n < 10 and 15000 ms after, never undefined. `ComposerModelPill` has no `Suspense` and no "Checking harnesses…" fallback; `createComposerHarness` reads the remembered list while its query is pending.
- AC-2 `withRememberedModels(fresh, remembered)` gives an available harness with no models the remembered harness's models, leaves harnesses with models (and unavailable ones) alone, and returns `fresh` unchanged without a remembered list. `harnessModelFor(instance, last)` returns `last` when that model is still listed (keeping effort and tier), else the harness default. `createHarnessSwitchQueue` shows a pick as pending at once, sends picks in order, `settled()` resolves after the last send (also on failure), and pending clears afterwards. Submit awaits a pending switch instead of refusing.
- AC-3 Home renders `HomeComposer`, which renders `PromptInputV2Composer`; `brain-home.tsx` no longer uses `ComposerBox` or `createComposerHarness`.
- AC-4 `.running-pulse` breathes (scale and opacity in and out, `running-breathe` keyframes, ease in-out, infinite) and stops under reduced motion. The turn's Working row shows a `running-pulse` dot, not `LoaderV2`; the sidebar running mark has `running-pulse`.
- AC-5 `asksUser(text)` is true when the last paragraph of the reply ends in a question mark (ignoring trailing markdown and code fences), false otherwise. `finishMark({ unseen, error, asks })` is `failed` for an unseen error, `reply` for an unseen turn that asked, `done` for another unseen turn, undefined when nothing is unseen.
- AC-6 Engine: `start` accepts `language`; `run_language(requested, supported)` passes a supported code and drops unsupported or `auto`; while recording the engine sends `{"type":"partial","text"}` events. Desktop: `partial` events reach `onPartial` listeners only while recording; `start({ language })` forwards the code. App: `dictationLanguage("auto"|code, locale)` maps the setting to the engine code (default follows the app language). A workshop page shows three live-transcript variants.
- AC-7 `SessionTodo.planFromToolCall(name, input)` returns the todos for `todowrite`, and for any tool whose input title is `todowrite`; other tools return undefined.
- AC-8 A harness or in-process session whose first turn is still running already has its generated title.
- AC-9 `getSessionContext` for an external-harness message without a live report uses the newest earlier message of the same harness that has one (`reported: true`, `total` its `contextUsed`, `limit` its window); with none it stays `reported: false`.
- AC-10 `scheduleBounds("agenda", cursor, week, today)` is `{ start: today, end: "9999-12-31" }` whatever the cursor; day and week keep their ranges.
- AC-11 `steadyStep(previous, next)` returns `previous` for a step with the same tool, status and title, `next` otherwise, undefined for none; the lane keys its line on that.
- AC-12 The custom-answer textarea draws no outline on focus; the custom option shows a 1.5px accent inset while focused (inspection, workshop).
- AC-13 A message whose `contextUsed` exceeds its window is not reported; the newest earlier same-harness report that fits stands in; a figure within the window is kept.
- AC-14 `liveSubagents(rows)` keeps running and pending rows only; the Running section lists `liveSubagents(...)`; opening a subagent closes the window.
- AC-15 The rail always renders the Canvas section (inspection).
- AC-16 `designDocument` puts the app's `::-webkit-scrollbar` pill rules before the design's own styles.
- AC-17 `soon(fn, ms)` runs on a timer while visible and as a message-channel task (no timer) while hidden; cancelling stops it in both cases.

Tests: beside the code (`*.test.ts`, Rust `tests/`), listed in
[`acceptance/README.md`](acceptance/README.md) and
[`verification/README.md`](verification/README.md). A frozen copy is kept
outside the repository.

## Existing tests changed

- `core/test/session-runner-title.test.ts` "titles a session whose first turn is stopped" asserted no title request while the first turn runs. That contradicts AC-8 (the user asked for the title at the beginning). Changed while writing this batch's tests (before the freeze): the title request has been made while the turn hangs. A harness variant was added.

## Test changes after the freeze

- `app/.../harness-memory.test.ts`: the `model()` helper gained `isDefault: false` so it type-checks against `Harness.Model` (required field). Assertions unchanged.
- `app/.../harness-ux-batch-2-verify.test.ts`: `instance()` casts through `unknown` for the same reason. Assertions unchanged.
- `desktop/.../fixtures/fake-dictation-engine.mjs`: the fixture's header said a `start` with a language makes the final name it, but the line storing the language was lost when the fixture was written. Added it; `dictation-partial.test.ts` is unchanged.
- `app/.../submit.test.ts` "waits for an in-flight Harness switch before submitting" (an existing test): it asserted a send during a switch is refused; AC-2 changes that contract to waiting. It now asserts nothing is sent before the switch settles, then releases it.
- Panel round 3 (to reach 9 from every reviewer):
  - `dictation-language.test.ts` (AC-6, app side) changed contract: the default is now English for an English app and detection otherwise (reviewer 2's design; a fixed app-language hint would translate a speaker whose app language differs). `harness-ux-batch-2-verify.test.ts`'s region case now uses the explicit "app" setting for the same reason.
  - `submit.test.ts`'s `@tenon/core/util/encode` mock now keeps `checksum`, `hash` and `sampledChecksum`: the file only loaded when another test had imported the real module first.
  - `e2e/regression/brain-home-loading.spec.ts` targets the thread composer and asserts no "Checking harnesses…" (it was already failing on base, at an error page from an unmocked usage request).
  - New: `e2e/regression/home-thread-composer.spec.ts` (Home usable while harnesses load, send opens the thread, Project pick carries the text), `harness-ux-batch-2-round3.test.ts`, `thread-finish-round3.test.ts`, a late-partial case in `dictation-partial.test.ts` (fixture flag `FAKE_DICTATION_LATE_PARTIAL`), and a run-options test in `dictation/src/language.rs`.
- Prettier re-wrapped some frozen test files (whitespace only).
- AC-15 and AC-16 were written after issues 18 and 19 arrived. AC-16 failed on the unfixed code first; AC-15 did not: the rail change had already been made when its test was written, so that test is a check after the fact, not a red-green test.
- AC-11, AC-13 and AC-14 tests were added after the freeze for issues raised mid-run; each was run on the unfixed code first (failed) and copied to the frozen set before the fix.

## Panel review (3 reviewers, Sonnet, medium effort)

Round 1 scores: harness and composer 7/10, core/engine/desktop 6/10, UI and status 7/10. Fixed after review:

- A failed harness switch no longer lets a waiting send go to the old harness (`settled()` reports success; submit keeps the prompt); a send waits only on its own thread's switch; a second Enter while waiting is ignored. Tests: verification "settled says whether...", `submit.test.ts` "keeps the prompt when the Harness switch it waited for failed".
- The context fallback stops at a compaction (verification test).
- Dictation: a second window's start is refused before it can take over the first recording's level, limit and live transcript; a refused `start` no longer changes the recording's language; stopping cancels an in-flight preview run (`CancelToken`), so the final run isn't held up by it.
- The sidebar finish mark follows the newest unseen ending (a later success clears "Failed"); `asks` loads the last messages of a thread that isn't in memory before reading the reply.
- The custom-answer focus edge is the full focus colour; the agenda's today follows the clock on focus; the halo is stronger; docs say the dot is steady under reduced motion.

Not changed, with reasons:

- (Changed in round 3, see below.) Dictation language defaulted to the app's language.
- (Changed in round 3: remembered models now expire.) Remembered models could outlive an agent that lists none.
- Narrow windows (< 768px) can't open the Agents tab from the Environment window: the side panel is desktop-only (pre-existing).
- OpenCode todo detection was questioned; the dev database has real OpenCode `tool.called` events with `title: "todowrite"` and `todos` input, the payload the runner reads.

## Panel round 2

After the fixes above: harness and composer 8/10, core/engine/desktop 8/10, UI and status 8.5/10. Fixed from round 2: the dictation caption follows the mic on resize and scroll; the asks lookup waits at most 2 s. Still open: the default spoken language (a product decision, see above), Home composer tests are source checks (behaviour verified live instead), the context guard isn't applied to the child-session figure in `context-strip.tsx`, and the Command Centre harness query retries every 15 s against a dead server.

## Panel round 3

Asked each reviewer what blocked a 9, then fixed: e2e behaviour tests for Home (which found two real regressions: the composer stayed on its placeholder while the Projects list loaded, and every Home visit started a new harness check; plus a pre-existing crash when the usage request fails), shared and reused harness checks (in-flight join, 30 s reuse, forced refetch asks), remembered models expire after a minute of an agent listing none, the compaction guard on the child-session figure, the dictation language default above with explicit `Task::Transcribe`, a `transcribing` error code, the asks lookup moved into a tested `replyAsks`. The `secondBrain.*` and new `dictation.*` strings are English-only, like the rest of those families (the i18n parity test covers the shared desktop keys only).

Round 3 scores: harness and composer 9/10, core/engine/desktop 9/10, UI and status 9/10. Their last non-blocking notes, fixed after scoring: a harness whose remembered models have expired no longer gets a remembered model restored on select or fallback (`rememberedModel` in `harness-controller.ts`); `replyAsks` also catches a load that throws before returning a promise and clears its timer (tested). Left as a trade-off: a non-English app with English speech still detects the language by default (the dictation setting overrides it), and no run used a real Whisper model.

## Completion evidence

Base `b075fd26`, branch `claude/harness-ux-issues-3806c8`, uncommitted. One agent wrote the plan, tests and code; the reviewers were separate agents.

Baseline: every new acceptance test failed before its fix (app 13 fail / 1 pass, core 8 fail, desktop 1 fail; AC-11, AC-13, AC-14, AC-16 failed first too; AC-15 did not, see above).

After the change:

- `bun run check` (typecheck, lint, format, generated client, tests, build): exit 0. App 1,267 tests, desktop 239, session-ui 183, all 17 tasks successful. The two post-round-3 edits were rechecked on their own: typecheck clean, app 1,267 pass, Prettier clean, lint warnings only.
- Core runner, todo and ACP tests: 145 pass (title, todo-plan, verify, ACP).
- Engine (`cargo test`, cached target dir): 8 pass.
- Live check on a separate local instance (backend :4199 with its own `tenon-ux2-verify.db`, app :4445, scratch workspace; the installed app untouched): Home shows the thread composer with no "Checking harnesses…"; switching to OpenCode showed its model within 150 ms; a send from Home created and opened the thread; the title arrived about 9 s in, before the first step ended; the running dot animates (`running-breathe`, 2 s); a thread that ended with a question while on another page showed "Needs your reply"; the Canvas rail button shows in a thread with no designs and opens the empty state. OpenCode's `usage_update` arrived at turn end (20,203 of 200,000).
- Side panel (P19), sampled live at 1280px: opening moved the thread column 878 → 458 px in one step; closing held 458 px for the slide, then 878 px.
- Not verified live: the tool-call expansion (P18; the pane was hidden, so animation frames didn't run), the stutter fix on a real minimized window (P17), dictation partials with a real model and microphone, OpenCode writing a todo list (the model didn't use its todo tool in the test run; detection is verified against real events in the dev DB), and the question field's focus look.
