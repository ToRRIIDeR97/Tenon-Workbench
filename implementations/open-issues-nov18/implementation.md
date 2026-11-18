# Open issues, 18 Nov 2026

Run with TOR-1-Agent: one agent wrote the map, plan, tests and code. The tests
are not independent of the implementation.

## Triage of the 24 open issues

| Issue | Decision |
| --- | --- |
| #320 harness updates run one at a time | Fix (P1) |
| #321 an outdated harness has no update action where it fails | Fix in the composer's harness picker (P2); the thread error is left (see below) |
| #322 every assistant row shows the turn's total time | Fix (P3) |
| #327 opening a tool card at the bottom jitters | Fix (P4) |
| #325 Browser tab is a blank white panel | Fix (P5) |
| #328 dictation caption loses words | Caption fixed (P6); final-text, language and test-recording questions go to the workshop |
| #309, #310, #311, #136, #164 | Already fixed on 16 Nov (`9d887b74`, `75ea5ed9`, `d8716d4d`); issues still open. Recommend closing, with the residual notes in the report |
| #334 MCP, #333 computer use, #332 compaction, #331 GitHub on Projects, #330 attachments, #329 Command Centre card, #326 Canvas comments, #323 harness skills, #312 sidebars, #308 Tasks vs context ring | Need product decisions: designs made, discussion later |
| #324 long threads lag | Needs a profile on a real long thread first (the issue asks for before/after numbers); not changed |
| #259 dependency upgrades | Its own upgrade pass; not in this batch |
| #245 Electron 45 manual check | Needs a person on macOS and Windows hardware |

## Feature map (causes found in code)

| # | Cause |
| --- | --- |
| #320 | `harnesses.tsx` keeps one `busy` string for the page; `run` returns while it is set, but only the busy harness's buttons are disabled, so another harness's Update looks live and does nothing. The update toast (`harness-update-notifier.tsx`) calls `upgradeHarness` on its own, so a toast and Settings can upgrade the same CLI twice. |
| #321 | The model pill's harness rows render an unavailable harness as a disabled `Choice` with the error only in a tooltip. Update checks run once per connection (notifier), so a CLI that became outdated while the app is open is never offered. The server's `upgrade` already closes runtimes and forgets the probe; `refreshHarnesses(id)` re-probes. |
| #322 | `session-turn.tsx` and `message-timeline.tsx` hand `turnDurationMs` (user message → last completion) to every assistant part; `message-part.tsx` prefers it over the message's own time. The turn steps card already shows the total. |
| #327 | `ToolGroup`/`ContextToolGroup` toggles don't call `holdBottom()`, so a resize at the bottom is end-anchored by virtual-core and then `anchorResizedBottom()` scrolls again; measurement waits a `requestAnimationFrame`, so the row is clipped to its old height for a frame. |
| #325 | `browser-tab.tsx` shows the native `WebContentsView` (white) over the stage whenever it has bounds, hiding the DOM empty state. `navigateBrowser` swallows `loadURL` errors; there is no `did-fail-load`/`render-process-gone`/`certificate-error` handling and no error in `browser-state`. |
| #328 | The engine re-transcribes only the last 28 s every 1.2 s; the button replaces the caption with each `partial`, so words older than the window vanish. |

## Change diagram

- [Current vs proposed](diagrams/change.svg)

## Parts

| ID | Outcome | Criteria | Files | Depends |
| --- | --- | --- | --- | --- |
| P1 | Upgrades of different harnesses run at once; the same harness never upgrades twice (Settings and toast share one registry); Settings locks per harness. | AC-1 | `components/harness-upgrades.ts`, `settings-v2/harnesses.tsx`, `harness-update-notifier.tsx` | – |
| P2 | An unavailable harness in the composer's harness picker shows its error, and Update when one is known; the update runs there, then the harness is re-probed. A harness turning unavailable triggers a fresh update check (at most once a minute). | AC-2 | `prompt-input/harness-update-choice.ts`, `harness-controller.ts`, `harness-controls.tsx` (type), `model-pill.tsx`, i18n | P1 |
| P3 | Each assistant row shows its own message's time; the total stays on the turn steps card. | AC-3 | `session-ui/.../message-duration.ts`, `message-part.tsx`, `session-turn.tsx`, `message-timeline.tsx` | – |
| P4 | Toggling a tool card stops following the bottom; the row is measured in a microtask; only one scroll correction per resize. | AC-4 | `timeline/resize-anchor.ts`, `timeline/measure.ts`, `message-timeline.tsx` | – |
| P5 | The native browser view shows only once a page has committed and hasn't failed; load failures, crashes and certificate errors reach the tab with the address and Retry. | AC-5 | `desktop/src/main/browser-failure.ts`, `browser.ts`, preload types, `pages/session/browser-stage.ts`, `browser-tab.tsx`, i18n | – |
| P6 | The live caption only grows: each partial is lined up with the caption and only the words that left the engine's window are kept in front. | AC-6 | `prompt-input/dictation-caption.ts`, `dictation-button.tsx` | – |

## Acceptance criteria

- AC-1 `createHarnessUpgrades` starts upgrades of two ids at once, joins a second start of the same id, clears `running` on failure, stores the result status and calls `onUpgraded`; `check()` shares one in-flight request. `createActionLocks` refuses a busy id, runs a different one, and releases on failure.
- AC-2 `harnessUpdateChoice(instance, update, upgrading)`: unavailable with an installable update → `update` (enabled); while upgrading → `updating` (disabled); otherwise unavailable → its first error line (disabled); available → undefined. `shouldCheckHarnessUpdates(list, lastCheck, now)` is true for an enabled unavailable harness and a check older than 60 s. The model pill uses the choice and can start the update.
- AC-3 `messageDurationMs` is the message's own span (assistant, finished, non-negative); message rows no longer read `turnDurationMs`.
- AC-4 `resizeAnchoring` holds the end and scrolls to it only while following and not within 800 ms of a toggle. `scheduleConnectedMeasure` measures in a microtask and returns a cancel function. Both tool group toggles call `holdBottom()`.
- AC-5 Desktop: `browserLoadFailure` reports main-frame failures except `ERR_ABORTED`; `browserCrash` reports anything but a clean exit. App: `browserStage` is `empty` for no page (or `about:blank`), `loading` for a first load, `error` for a failure, `page` once committed.
- AC-6 `mergeCaption(previous, next)` keeps the words that left the window and never drops a word through a 320-word sliding-window dictation; an unrelated rewrite replaces the caption. The button uses it.

Tests sit beside the code (`*.test.ts`), listed in [acceptance/README.md](acceptance/README.md).
A frozen copy is kept outside the repository.

## Test changes after the freeze

- `harness-update-choice.test.ts` (AC-2): the "disabled harness" assertion and the fixture's `enabled` field were removed. `Harness.Instance` has no `enabled` field; the harness list only carries enabled harnesses (`core/src/harness.ts` `list()` filters them), so the case cannot occur. The contract of `shouldCheckHarnessUpdates` changed to read `status` only.
- `harness-upgrades.test.ts` (AC-1): `String(...)` around a branded `InstanceID` so `toBe("codex")` type-checks. Assertion unchanged.
- Prettier re-wrapped `harness-update-choice.test.ts` (whitespace only).

## Not done in this batch, with reasons

- #321's thread error: a send to an unavailable harness fails in the session runner; offering Update there needs a decision on how a thread error carries actions (it is in the workshop with the picker row).
- #328's final pass ("finishing…", keep-what-I-saw), the per-recording language and Settings test recording are decisions; designed in the workshop.

## Completion evidence

Base `a4e36694`, branch `claude/open-features-issues-de18b8`, uncommitted. One agent wrote the plan, tests and code;
there was no separate verifier.

- Baseline: every new acceptance test failed at base (modules missing): app 5 files, session-ui 1, desktop 1.
- After the change: all acceptance tests pass (AC-1 7, AC-2 8, AC-3 3, AC-4 6 plus the existing `measure.test.ts`,
  AC-5 4 + 5, AC-6 7).
- `bun run check` (typecheck, lint, format, generated client, tests, build): exit 0. App 1,303 tests, desktop 243,
  session-ui 186. The first run failed only on Prettier for `browser-stage.test.ts`; formatted and rerun.
- Diff review: test files compared with the frozen copy; the only differences are the two recorded above.
- Not verified live: none of P1–P6 was run in the desktop app. The Browser tab states need Electron's native view;
  the picker's Update row needs an outdated harness CLI; the tool-card jitter and the dictation caption need a real
  long thread and microphone. Each is covered by its unit tests only.
- Docs: `docs/architecture/README.md` (Browser tab states and `browser-state.error`; the shared upgrade registry and
  the picker's Update row).
- Designs for the decision issues: one workshop page (two animated variants per issue, decisions listed) at
  https://claude.ai/artifact/LU3npU2ACXUdFpMb1EJY5g. Built on the app's `--v2-*` token values and easing, not on a
  dump of the running app's markup.

## Round 2 (after the workshop): #323 harness skills, variant A

The user chose variant A (a switch per harness skill, the change explained in the row). Variant A's mock said the
folder is renamed to `name.disabled`. That would not work: every harness (and Tenon's own scan) finds skills by
the file name `SKILL.md` anywhere under its skill folders, so a renamed folder still loads. The switch renames the
file instead: `SKILL.md` → `SKILL.md.disabled` and back.

| ID | Outcome | Criteria | Files |
| --- | --- | --- | --- |
| P7 | A harness skill in a home or project folder can be switched off and on; switching renames its `SKILL.md`; system folders and reported commands stay read-only; the route takes a harness ID and a name, never a path. | AC-7 | `core/src/harness/skills.ts`, `schema/src/skill.ts`, `protocol/src/groups/skill.ts`, `server/src/handlers/skill.ts`, generated client |
| P8 | Settings → Skills shows the switch on those rows, says what it changed, and names another harness that reads the same file. | AC-8 | `settings-v2/skills.tsx`, `skills-sections.ts`, `utils/server.ts`, i18n |

- AC-7 (`core/test/harness-skills-toggle.test.ts`): listed home skills are `enabled` and `editable`; off renames to
  `SKILL.md.disabled` with the content unchanged and lists the skill as off; on restores it byte for byte; an
  unknown or reported skill is refused; `toggledLocation` with `path.posix` and `path.win32` fixtures.
- AC-8 (`app/.../skills-harness-switch.test.ts`): `switchable`, `sharedWith`, `setSkillEnabled` sends `harness`,
  the page uses `switchable` and the rename text.

Baseline: both files failed before the change (core 8 fail, app module missing). Frozen with the round 1 set.

Test change after the freeze: "switching on never overwrites a SKILL.md that appeared beside the disabled one"
expected a failure. With both files in the folder, the scan lists the live `SKILL.md` (it sorts first), so the skill
is already on and switching it on is a no-op. The test now checks that it succeeds and that neither file changed;
its point (nothing is renamed over an existing file) is unchanged, and the no-overwrite guard stays in `rename`.

Round 2 evidence: AC-7 8 pass, AC-8 4 pass. `bun run check` exit 0 (app 1,307 tests) after staging the regenerated
client (`check:generated` compares the working tree with the index). `bun run test:engine`: 1,408 pass, 4 fail; the
four (`git.test.ts`, `harness-setup.test.ts` file mode `0600`, `npm` git-dependency install,
`workspace-instructions.test.ts` symlink) are Windows environment failures in files that import nothing changed
here. Not checked live: a real harness skipping a `SKILL.md.disabled` skill (it relies on each harness loading
skills by the file name `SKILL.md`, as their docs and Tenon's own scan do).

## Round 3: #334 MCP servers as one list, variant A

| ID | Outcome | Criteria | Files |
| --- | --- | --- | --- |
| P9 | The global config can lose one MCP server through `DELETE /global/config/mcp/:name` (`Config.removeGlobalMcp`; jsonc keeps comments). A config patch could only add or change keys, which is why removal never existed. | AC-9 | `tenon/src/config/config.ts`, `httpapi/groups/global.ts`, `handlers/global.ts`, `test/fixture/config.ts` |
| P10 | Each row shows live status, the fix in the row (Sign in, Retry), which harnesses receive it, a switch, and opens in place with what it runs and Remove. Custom server is a typed form (arguments kept whole, environment, folder, timeout; URL and headers; pasted JSON). The MCP dialog links to Settings. | AC-10, AC-11, AC-12 | `settings-v2/mcp-servers.tsx`, `mcp-servers-model.ts`, `utils/server.ts`, `dialog-select-mcp.tsx`, i18n |

Choices made without asking (the workshop listed them as open): the switch stays the config `enabled` flag, with the
live state and its fix shown beside it; Settings shows and edits the global config only (folder overrides are not
shown); MCP tools don't join the permission modes. Existing servers can't be edited or renamed in the app because
`/global/config` redacts environment values and headers, so a rewrite would replace secrets; Remove and add again
instead. Not built: the per-server tool list (no route lists one server's tools).

Tests: AC-9 in `tenon/test/config/config.test.ts` (json and jsonc), AC-10 to AC-12 in
`app/.../mcp-servers-rows.test.ts`. Baseline: all failed before the change. No test changed after the freeze.

## Round 4 (user decisions: dictation words in the composer, all open issues as tasks, canvas pins kept)

| ID | Outcome | Criteria | Status |
| --- | --- | --- | --- |
| P11 #321 | A harness that only answered its start check late stays available, marked "Slow to start" (with "x available" when an update is known); only a protocol mismatch or a CLI that doesn't start disables it. `Harness.Instance.slowStart`, `AcpHarness.probeFailure`. | AC-13 (`core/test/harness-slow-start.test.ts`, `app/.../harness-slow-start.test.ts`) | Done, tests pass |
| P12 #326 | Canvas Notes: an in-frame picker (plain script, `session-ui/.../design-inspect.ts`) reports selector, tag, text and box; the app draws highlight, note popover, numbered pins and a tray; Send puts the notes in the composer; sent pins stay, marked sent, per design version. | AC-14 (`session-ui/.../design-inspect.test.ts`), AC-15 (`app/.../canvas-notes.test.ts`) | Done, tests pass |
| P13 #328 | The engine sends `bands` (24 log-spaced bands, 80 Hz to 6 kHz, every 30 ms chunk); desktop forwards them while recording (`dictation-bands`); the composer shows the live words and a 32-bar wave at the top of its box (compact composer keeps the floating caption). Language stays in Settings › Dictation. | AC-16 (Rust `audio.rs` tests, `desktop/.../dictation-bands.test.ts`, `app/.../dictation-wave.test.ts`) | Done, tests pass; needs an engine rebuild to show real bands |

Test changes after the freeze: `design-inspect.test.ts` built its element tree with happy-dom, which session-ui
tests don't have; it now builds a minimal tree by hand with the same assertions (changed before any implementation).
The Rust band test first failed on the code (a tone between two band centres read as silence); the code was fixed
(each band takes its loudest bin), not the test. `canvas-tab.tsx` names the shared store `canvasNotesStore` so the
source check finds it.

| P14 #330 | The composer accepts video (mp4, mov, m4v, webm, mkv, avi, ogv), audio (mp3, wav, m4a, aac, flac, ogg, oga, opus, aiff, wma) and documents (docx, pptx, xlsx, doc, ppt, xls, odt, odp, ods, rtf, epub) with their real type. At send (`prepareAttachments`), a video for an image-only model becomes 3×3 (or 2×2) frame grids stamped with times (1 to 4 grids by length), office/OpenDocument/RTF/EPUB files their extracted text, and audio or legacy Office files a stand-in naming the file and its length. Cards say "Video · sent as frames", "Sent as text", "Audio · name and length only" or "Name only". | AC-17 (`app/.../attachment-media.test.ts`, `session-ui/.../attachments-media.test.ts`) | Done, tests pass |

Not done for #330: the model's own input types aren't passed yet (`FollowupDraft.inputs`), so every model is treated as
reading images and PDF (a video-capable model also gets frames); audio isn't transcribed locally; the file viewer
has no audio player or pptx/odt/rtf/epub reader. Frame extraction and document text weren't run on real files.
| P15 #332 | A sharp drop in an external harness's context in use between two turns (from at least 20k, to 60% or less, by at least 15k) shows a divider: "Claude Code compacted its context (seen from usage: 182k → 41k)". Tenon's own compaction divider is unchanged. | AC-18 (`app/.../timeline/harness-compaction.test.ts`) | Done, tests pass. The test and the detector were written together, so the test had no separate failing baseline run |

Not done for #332: skipping a Tenon compaction in a turn the harness already compacted, and marking Settings' compaction controls "built-in agent only".
| P16 #331 | A Project's Tasks list its repository's open issues as tasks (each with the PR that closes it and its state), and recently closed ones under All, read with the gh CLI login through `POST /api/github/work`. The repository is the folder's origin unless the Project names another. Rows open on GitHub (read-only). | AC-19 (`core/test/github-work.test.ts`), AC-20 (`app/.../github-tasks.test.ts`) | Done, tests pass. Test kept after the freeze; the code was changed so a draft PR reads "Draft" even with failing checks |

Not done for #331: an issue an agent files isn't linked back to its thread (no record of which thread ran `gh issue create`), and progress isn't derived from closed issues.

Existing test changed for #331: `client/test/promise.test.ts` lists every client group by name; the new `github`
group (named in `client/src/contract.ts`) was added to that list.

| P17 #333 | Computer use per Project (variant B), whole desktop, through the Cua Driver (user's choice): a Project card switches it (off by default, `computer-use.json`); ACP threads started in that folder get `cua-driver mcp` as an MCP server; Codex and Claude Code never do. The card shows the install command or the macOS grant command when needed. | AC-21 (`core/test/harness-computer-use.test.ts`), AC-22 (`app/.../project-computer-use.test.ts`) | Done, tests pass; the Cua Driver isn't installed on this machine, so no real run |

Existing test changed: `client/test/promise.test.ts` also lists the new `computerUse` group.
Not done for #333: the built-in agent, a per-action approval or on-screen indicator, and stopping a running thread when the switch goes off.

| P18 #333 follow-ups (proxy, 1A, 2A, 3A + 3B) | Tenon runs `cua-driver mcp` and proxies it: ACP agents get `computer_*` tools on the tenon MCP server, the built-in agent in-process. Every call checks the switch (off refuses the next action); screen reads never ask; the first click or keystroke in a thread asks once; each action shows a Stop pill on screen; Stop kills the driver at once and clears grants. | AC-23 (`core/test/harness-computer-proxy.test.ts`), AC-24 (`desktop/.../computer-indicator.test.ts`, written after the code) | Done, tests pass; no real run (driver not installed) |

Not done: the built-in agent's tools are read when the folder's services start (switching on there needs a restart); the pill hasn't been seen on a real screen.

### Test change after round 4 (C2-6 contract)

`core/test/harness-computer-proxy.test.ts` "Stop shuts the driver down and forgets every thread's grant": a thread that used the desktop moments before Stop now first hears "pressed Stop" on its next action (the panel's C2-6 asked that every thread Stop ended be told), and the action after that asks again. The assertion that the grant is forgotten is unchanged; one step was added before it.
