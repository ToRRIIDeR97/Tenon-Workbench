# Mobile companion, thread sync and full test pass

- Mode: TOR-Workflow with TOR-3-Agents (two implementors, one verifier), then the review panel.
- Subagents: Opus 5.5, medium effort (the user's choice, panel included).
- Base commit: `9623f3030f85e5128b118b8a6f3a9873bc4562e9` on `claude/mobile-app-planning-84f916`.
- Plan author: the orchestrating agent. It wrote both test sets; `verification/` is kept outside the
  repository and is given only to the verifier and the reviewers.
- This folder uses the repository's existing lower-case `implementations/`.

## Problem and expected behaviour

Tenon Workbench runs on one computer. The user wants:

1. every feature inventoried and tested, with the gaps closed;
2. the Device tab working for Android and, as far as code can show, iOS;
3. a thread started on one computer continued on another, stored in the user's Google Drive;
4. a phone app for Android and iOS;
5. a ranked list of further features, then the best of them built.

Before: the server listens on loopback with one generated password, a thread's events live only in the
local `tenon.db`, the Device tab sends Home for every iOS key, and there is no list of what is tested.

After: a feature test matrix says how each feature is tested; a phone paired with the computer can read
and steer threads; a thread's encrypted event segments sit in a folder in the user's own Google Drive and a
second computer can take the thread over.

## Decisions already made by the user

| Decision | Choice |
| --- | --- |
| Mobile scope | A companion to the computer, built with Capacitor around the existing renderer |
| iOS | Written but unverified: there is no Mac |
| Android SDK | Installed on this computer |
| Sync storage | A folder the user can see in their own Google Drive, personal use, one Google account (changed on 2026-11-27 from a Cloud Storage bucket; see P4b) |
| Merging | Pull requests, merged only after the user approves |

## Diagrams

![Current system: renderer, Electron main and a loopback-only server on one computer; threads stay in the local event log](diagrams/current.svg)

![Proposed system: a paired phone app, and thread sync through an encrypted folder in Google Drive to another computer](diagrams/proposed.svg)

![Thread sync detail: append, encrypt and upload a segment, then the other computer downloads, replays and takes ownership](diagrams/detail-thread-sync.svg)

Sources for the current view: `tenon/packages/desktop/src/main/server.ts` (`spawnLocalServer`, loopback
and password), `tenon/packages/core/src/event.ts` (`replay`, `replayAll`, owner check),
`tenon/packages/tenon/src/server/routes/instance/httpapi/handlers/sync.ts` (existing replay and steal
routes), `tenon/packages/desktop/src/main/device.ts`, `tenon/packages/app/src/components/settings-v2/servers.tsx`.
The proposed and detail views are proposals until each phase's verified commit exists.

## Phases

Later phases get their detailed criteria and both test sets written by the plan author before that phase
starts; this section fixes their outcome, scope and order now.

| ID | Outcome | Edit scope | Depends on | Runs with |
| --- | --- | --- | --- | --- |
| P1 | A feature test matrix and a recorded baseline of every existing suite | `docs/records/feature-test-matrix.md`, `docs/records/test-baseline-2026-11-26.md`, `docs/README.md` link | independent | P2 |
| P2 | Device input, SDK discovery and boot feedback are correct on both platforms | `tenon/packages/desktop/src/main/device.ts`, `device.test.ts`, `tenon/packages/desktop/src/main/browser.ts` (device tool branch only), `tenon/packages/core/src/harness/browser-tools.ts` (`device_*` descriptions only), `tenon/packages/app/src/pages/session/device-tab.tsx`, new `device-boot.ts` and its test beside it, `tenon/packages/app/src/i18n/*`, the Device tab paragraph of `docs/architecture/README.md` | independent | P1 |
| P3 | Every `gap` row of the matrix has an automated test or a recorded manual run; bugs found are fixed or filed | new specs under `tenon/packages/app/e2e/`, unit tests beside code, small fixes | P1 | P4 |
| P4 | Thread sync engine: export, encrypt, upload, download, replay and ownership transfer behind a storage interface with a local-folder store and a Cloud Storage store (replaced by a Google Drive store in P4b) | new `tenon/packages/core/src/thread-sync.ts` and `src/thread-sync/`, `tenon/packages/core/test/thread-sync/`, `docs/architecture/README.md` (new section), `docs/architecture/uml.md`, `docs/security/threat-model.md` (new section), `docs/diagrams/` (new file) | independent | P3 |
| P5 | Thread sync in the app: Settings page, per-thread state, "Continue here" | `tenon/packages/app`, `tenon/packages/desktop/src/main` | P4 | P6 |
| P6 | Remote access: pairing by QR code, per-device tokens that can be revoked, a scope that leaves out terminals and computer use | server auth, `tenon/packages/desktop/src/main`, Settings › Servers | independent | P5 |
| P7 | Phone layout of the renderer below 600 px | `tenon/packages/app`, `tenon/packages/ui` | P6 | alone |
| P8 | Capacitor shell: Android build verified on an emulator, iOS project written and unverified | new `tenon/packages/mobile` | P7 | alone |
| P9 | Ranked feature backlog, then the features the user picks | set per feature | P3 | set per feature |
| P0 | The app e2e suite passes five default-worker runs in a row (first-wave time-outs investigated) | `tenon/packages/app/e2e/**`, `docs/records/` | independent | alone |

From 2026-11-27 one agent runs the remaining phases with the TOR-1 loop and no subagents, in this order,
each on its own local branch stacked on the previous one: P0 `claude/e2e-first-wave-timeouts`, P5b
`claude/thread-sync-desktop`, P6b `claude/remote-access-desktop`, P7 `claude/phone-layout`, P8
`claude/mobile-shell`, P3c `claude/feature-gap-tests`, P3d `claude/manual-feature-checks`, P9
`claude/feature-backlog`. The review panel is replaced by a scored self-review in three lenses (plan
conformance, correctness and regressions, integrity and scope); one author wrote the plan, both test sets
and the code. Verification sets are kept outside the repository
(`C:\Users\sense\.tor-verification\tenon-mobile-sync\frozen\<phase>\`).

## P0: first-wave e2e time-outs

Reported: with ten Playwright workers the first test each worker starts (dictation-web AC-2.4,
agent-writes AC-6.1, live-canvas-board AC-24, live-canvas-follow AC-9..11, live-document AC-18..19,
live-tracked-edits AC-25, notes-f AC-4.1) often timed out after 10 s waiting for the first page; with one
worker everything passed.

### Acceptance criteria

- **AC-P0-1 Measured.** Five default-worker runs of `bun run test:e2e` on the base, with the machine
  otherwise idle, are recorded per run (passed, failed, which tests, wall time) in
  `docs/records/e2e-first-wave-2026-11-27.md`.
- **AC-P0-2 Cause.** The record names the cause of the first-wave time-outs with an experiment that turns
  them on and off, or says the cause was not found and what was tried.
- **AC-P0-3 Fixed at the right layer.** Every test that failed in the measured runs is either fixed where the
  fault is (the app, the fixture or the test's own synchronisation) with a stress run that fails before and
  passes after, or recorded as unexplained with its failure rate. No `.skip`, `.fixme`, `.only`, raised
  time-out, retry or fixed sleep.
- **AC-P0-4 Five clean runs.** Five default-worker runs of the full `bun run test:e2e` in a row end with no
  failed test; if not, the record lists every failure and the phase says so.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P0-1, 2, 4 | the five full default-worker runs (`PLAYWRIGHT_PORT=3105 PLAYWRIGHT_SERVER_PORT=4105 bun run test:e2e` in `tenon/packages/app`) | the same runs read back from their logs |
| AC-P0-3 | each changed spec with `--repeat-each=20` or more at the default workers, before and after | the cold-cache experiment: the acceptance specs with and without the Markdown worker's `optimizeDeps.include`, `node_modules/.vite` deleted first |

Each phase is one pull request. Nothing is merged without the user's approval.

## P1: feature test matrix and baseline

### Contract

`docs/records/feature-test-matrix.md` holds one or more Markdown tables with exactly this header:

```text
| ID | Area | Feature | Source | Coverage | Evidence | Status | Notes |
```

- `ID` is `F-` and three or more digits, unique in the file.
- `Source` holds one or more identifiers in backticks: a route path, an IPC channel, a tool name, an
  HTTP route, `settings:<tab>`, or a repository-relative file path.
- `Coverage` is one of `unit`, `e2e`, `unit+e2e`, `none`.
- `Evidence` holds repository-relative paths of existing test files in backticks; empty only when
  `Coverage` is `none`. `e2e` coverage cites at least one file under an `e2e/` folder; `unit` coverage
  cites at least one test file outside it.
- `Status` is one of `covered`, `gap` (needs a new automated test in P3), `manual` (can only be checked
  by driving the app) or `blocked` (needs something this computer lacks: a Mac, an account, a microphone).
- `Notes` is required for `manual` and `blocked` rows and says what is needed.

`docs/records/test-baseline-2026-11-26.md` holds one table with the header
`| Command | Working directory | Result | Passed | Failed | Notes |` and one row per command below, with
`Result` one of `pass`, `fail`, `not run`. A `not run` row says why in `Notes`. Every failing test is
named under the table with the matrix ID it belongs to.

Commands: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run check:generated`,
`bun run test`, `bun run build`, `bun run test:engine`, `bun run test:routes`, `bun run test:desktop`,
`bun run test:app`, and `bun run test:e2e` in `tenon/packages/app`.

### Acceptance criteria

- **AC-P1-1** The matrix exists, every table has the header above, IDs are unique and well formed, and
  `Coverage` and `Status` use only the listed words.
- **AC-P1-2** A row whose `Coverage` is `none` has status `gap`, `manual` or `blocked`; every other row
  has at least one `Evidence` path, and every `Evidence` path is an existing file.
- **AC-P1-3** Every literal route path in `tenon/packages/app/src/app.tsx` (`<Route path="…">`) appears
  in a `Source` cell.
- **AC-P1-4** Every IPC channel registered in `tenon/packages/desktop/src/main/ipc.ts` (`trustedHandle`,
  `trustedOn`, `ipcMain.handle`, `ipcMain.on`) appears in a `Source` cell.
- **AC-P1-5** Every tool name in `tenon/packages/core/src/harness/browser-tools.ts` appears in a `Source` cell.
- **AC-P1-6** Every Settings tab in `tenon/packages/app/src/components/settings-v2/dialog-settings-v2.tsx`
  (`TabsV2.Trigger value="…"`) appears as `settings:<value>` in a `Source` cell.
- **AC-P1-7** Every `/second-brain/…` and `/command-centre/…` route path in
  `tenon/packages/tenon/src/server/routes/instance/httpapi/groups/second-brain.ts` appears in a `Source` cell.
- **AC-P1-8** Every Playwright spec under `tenon/packages/app/e2e/{acceptance,regression,smoke,user-story}`
  is the `Evidence` of at least one row.
- **AC-P1-9** `manual` and `blocked` rows have notes.
- **AC-P1-10** The matrix has rows for the features the user named: subagents and child threads, dragging
  threads with the mouse, file upload and attachments, cross-harness delegation, terminals, the Browser
  tab, the Device tab, dictation, routines, the desktop widget, harness sync, Calendar and Google sync,
  the Command Centre, token usage, and the note editor. The test looks for these words in `Feature`,
  ignoring case: `subagent`, `drag`, `upload`, `delegat`, `terminal`, `browser tab`, `device tab`,
  `dictation`, `routine`, `widget`, `harness sync`, `calendar`, `command centre`, `usage`, `editor`.
- **AC-P1-11** The baseline file exists with a row per command and a valid `Result`; no product code,
  test or configuration file changes in this phase.
- **AC-P1-12** The matrix is accurate, not only complete: a row describes a real feature a user or agent
  can reach, one row covers one feature (channels and routes of the same feature share a row), and a
  `covered` row's evidence exercises that feature. The verifier and reviewers read at least 15 rows
  against the code and the cited tests; a wrong row is a defect.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P1-1, 2, 3, 4, 5 | `acceptance/p1-matrix.test.ts` | `verification/p1-matrix.test.ts` (different extraction and row checks) |
| AC-P1-6, 7, 8, 9, 10, 11 | stated here | `verification/p1-matrix.test.ts` |
| AC-P1-12 | | reading rows against the code |

## P2: Device tab and device tools

### Contract

`tenon/packages/desktop/src/main/device.ts` exports two pure functions; `deviceInput` runs exactly the
commands the first one returns, in order, and stops at the first failure.

```ts
inputCommands(platform: DevicePlatform, id: string, input: DeviceInput): Array<{ tool: "adb" | "idb"; args: string[] }>
sdkRootCandidates(input: { env: Record<string, string | undefined>; platform: NodeJS.Platform; home: string }): string[]
```

`tenon/packages/app/src/pages/session/device-boot.ts` exports:

```ts
bootStage(input: { requestedAt: number | undefined; now: number; running: boolean }): "idle" | "starting" | "slow" | "timeout"
deviceHint(device: { platform: "android" | "ios"; state: string }): "unauthorized" | "offline" | undefined
```

### Acceptance criteria

- **AC-P2-1** iOS keys: `home` is `idb ui button --udid <id> HOME`; `enter` is `idb ui key --udid <id> 40`
  (the HID Return key); `back` throws an error whose message contains `Back` and runs nothing.
  Before: all three pressed Home (`device.ts:156`).
- **AC-P2-2** Android keys are unchanged: `KEYCODE_HOME`, `KEYCODE_BACK`, `KEYCODE_ENTER` through
  `adb -s <id> shell input keyevent`.
- **AC-P2-3** Android text: any character that is neither printable ASCII (space to `~`) nor a line
  break throws an error whose message contains `ASCII` and runs nothing; a line break (`\n` or `\r\n`) types the text before it, then
  `KEYCODE_ENTER`, then the rest; an empty line sends only the key; empty text returns no commands. Each
  typed piece uses the existing `androidText` escaping.
- **AC-P2-4** Tap and swipe coordinates are rounded and never negative, on both platforms; Android
  swipes keep the 300 ms duration. iOS text is one `idb ui text --udid <id> <text>`; empty text returns
  no commands.
- **AC-P2-5** `sdkRootCandidates` returns, in order, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, then the
  platform default: `<LOCALAPPDATA>\Android\Sdk` on Windows (built with `path.win32`),
  `<home>/Library/Android/sdk` on macOS, `<home>/Android/Sdk` elsewhere (built with `path.posix`). Unset
  or empty variables add nothing, so no relative path is ever returned. Before: an unset `LOCALAPPDATA`
  produced the relative `Android\Sdk`.
- **AC-P2-6** `bootStage`: `idle` with no request or once the device is running; `starting` for the
  first 60 s after a request; `slow` from 60 s; `timeout` from 180 s. The Device tab shows a line for
  `starting`, `slow` and `timeout` (i18n keys, English source copy) and refreshes the device list every
  2 s while a boot is pending.
- **AC-P2-7** `deviceHint`: an Android device in state `unauthorized` or `offline` returns that word;
  `device`, any iOS state and anything else return `undefined`. The Device tab lists such a device with a
  hint line instead of showing nothing.
- **AC-P2-8** The `device_key` tool's description says Back is Android only and that Enter works on
  both; on iOS a `back` call returns the AC-P2-1 error to the agent.
- **AC-P2-9** No new IPC channel, route or tool name. Existing `device.test.ts` cases keep passing. The
  Device tab paragraph in `docs/architecture/README.md` describes the new behaviour. No comments in
  source code; user-visible text goes through i18n.

Added on 2026-11-26 at the user's request, after seeing the Device tab with a live emulator ("please fix
the layout of the phone inside the emulators"). Before: the bezel was as tall as the panel, so black
bands sat above and below the screen; the phone hugged the left edge; Home, Back and "Screenshot to
thread" were bare text beside it and wrapped.

- **AC-P2-10 Phone layout.** The bezel wraps the screen image with the same inset on all four sides (no
  band above or below it) at the image's own aspect ratio, portrait or landscape. The phone is centred
  in the panel and always fits inside it, at any panel width from 320 px and any height, without being
  clipped or covered. The placeholder shown before the first frame has the same shape. The controls
  (Home, Back on Android, Screenshot to thread) are one tidy toolbar of the app's own v2 buttons with
  tooltips and accessible names, placed so they never wrap or push the phone off-centre. The image
  element's box equals the displayed bitmap, so a tap still lands where it is clicked.
- **AC-P2-11 Gone device.** When the device being shown disappears, its last frame and any screenshot
  error are cleared and the tab returns to "Start a device"; errors shown in the tab carry no
  `Error invoking remote method '…':` prefix.

Added after review panel round 1 (bugs the reviewers found that no criterion covered):

- **AC-P2-12 Input robustness.** A coordinate that is not a finite number is sent as `0`. An input whose
  `kind` or `key` is not one of the listed values, or whose text is not a string, is refused with an
  error before any command is built, on both platforms. The Device tab never shows a frame at a shape
  that is not its own (a landscape device's first frame is not stretched, and a new device's
  placeholder does not take the previous device's shape), and its boot timer runs only while a boot is
  starting or slow.

Checked by the orchestrator against the live emulator: bezel and image rectangles, centring and fit at
three panel sizes, a tap on a known target, and screenshots.

Invariants: `ipc.ts` handlers stay thin; no shell string is built (arguments stay an array to
`execFile`); the renderer still passes only platform, device ID and input.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P2-1 to 5 | `acceptance/p2-device.test.ts` | `verification/p2-device.test.ts` (other inputs and orders) |
| AC-P2-6, 7 | `acceptance/p2-device-boot.test.ts` | `verification/p2-device-boot.test.ts` (boundaries) |
| AC-P2-8, 9 | diff review | diff review, `bun run typecheck`, `bun run lint` |
| Manual | | the orchestrator drives an Android emulator through the Device tab after the SDK install; iOS stays unverified |

## P3: repair the baseline, then close the gaps

P1's baseline on the base commit found `bun run test:e2e` failing 66 of 221 tests and
`bun run test:engine` failing 3 (plus 2 in the half that never ran). P3 has four parts. P3a and P3b run
as a pair from the integrated P1 and P2 commit; P3c and P3d follow.

| Part | Outcome | Edit scope |
| --- | --- | --- |
| P3a | The thread-view end-to-end failures are repaired | `tenon/packages/app/e2e/regression/session-*.spec.ts`, `e2e/regression/terminal-*.spec.ts`, `e2e/regression/prompt-thinking-level.spec.ts`, `e2e/smoke/**`, shared `e2e/utils/**` and fixtures; product fixes under `tenon/packages/app/src/pages/session/**`, `tenon/packages/app/src/context/terminal.tsx`, `tenon/packages/session-ui/**`; `docs/records/e2e-repair-2026-11-26-thread-view.md` |
| P3b | The other end-to-end failures and the engine failures are repaired | every other failing spec (`e2e/acceptance/**`, `e2e/user-story/**`, the remaining `e2e/regression/*.spec.ts`); product fixes elsewhere in `tenon/packages/app/src` and `tenon/packages/ui`; `tenon/packages/core/test/{git,harness-setup,workspace-instructions}.test.ts`, the harness key file code in `tenon/packages/core/src/harness/`, `tenon/packages/tenon/test/server/httpapi-session.test.ts`, `tenon/packages/tenon/test/tool/registry.test.ts`, the root `package.json` `test:engine` script and the `AGENTS.md` line that names it; `docs/records/e2e-repair-2026-11-26-app.md` |
| P3c | Every `gap` row of the matrix has an automated test, or is reclassified with a reason the plan author accepts | new test files only, plus the matrix |
| P3d | Every `manual` row has a recorded run in the real app with evidence | `docs/records/` only; bugs found become fixes in their own change |

A fix that needs a file in the other part's scope is reported, not made.

P3b also refreshes the matrix to the tree it works on. The matrix records the base commit `e125392b`
(its header says so), and P1 and P2 are separate pull requests, so P1 cannot cite P2's new tests.
The integration check found three rows P2 changes: F-1010 (its note must say input commands and SDK
discovery are now tested and what is left), F-1212 (coverage `unit`, citing `device.test.ts`, still
`blocked` for a real run) and F-1210 (add `device-boot.test.ts`). P3b updates them along with the rows
its own repairs change.

### Acceptance criteria (P3a and P3b)

- **AC-P3-1** `bun run test:e2e` in `tenon/packages/app` ends with no failed test and no more skipped
  than on the baseline (1). The number of tests run is at least the baseline's 221 less the tests
  deleted as `feature removed`, each of which is listed in a repair record. A test that fails on the
  base but is missing from the baseline list (the verifier found one,
  `remote-session-settings.spec.ts` "auto-accept responds for an unfocused server session") is
  repaired and recorded like the others.
- **AC-P3-2** Each of the 66 baseline failures has a row in that part's repair record, a table with the
  header `| Spec | Test | Decision | Evidence | Change |`. `Spec` and `Test` are copied from the
  baseline's failing-test table. `Decision` is `spec drifted` (the app is right and the spec was
  updated to what the app is meant to do), `app regressed` (the spec is right and the app was fixed) or
  `feature removed` (the test was deleted because the feature no longer exists). `Evidence` names the
  commit, document or code that shows which side is right. `Change` names the files changed.
- **AC-P3-3** Nothing is weakened: no new `.skip`, `.fixme` or `.only`; a test is deleted only for
  `feature removed`; a repaired test still asserts the behaviour its title names; timeouts are raised
  only with a measured reason in the record.
- **AC-P3-4** `Failed to list terminals` is fixed in `context/terminal.tsx` (a non-array answer is
  handled) with a unit test. A locator that matched two elements is fixed by naming the element
  precisely, unless the two elements share an accessible name by mistake, which is then fixed in the app.
- **AC-P3-5** `bun run test:engine` passes on this Windows computer and runs both packages even when
  the first fails, exiting non-zero if either fails. Symlink tests skip, with the reason printed, only
  when the operating system refuses to create a symlink (probed at run time, not decided by platform
  name). The harness key file is private on Windows as well (its access list names only the current
  user) and the test checks the protection the platform really has. The session compact test and the
  plugin registry time-out are each decided like AC-P3-2 and recorded.
- **AC-P3-6** `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test` and
  `bun run test:app` still pass. No source comments.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P3-1, 5, 6 | the suites themselves | the verifier runs them on the candidate |
| AC-P3-2, 3 | stated here | `verification/p3-repair.test.ts` (every baseline failure has a decided row; skip, spec and test counts) and reading repaired specs against their titles |
| AC-P3-4 | the implementor's unit test | diff review |

## P4: thread sync engine

A library in `tenon/packages/core` that moves one thread's event log between computers through an
object store. It has no server route, no setting and no UI; P5 adds those, with the Google sign-in that
supplies the Cloud Storage token (now the Google Drive token, P4b).

Facts it builds on (verified on the base commit): both thread formats write durable events to the
`event` table with one sequence per thread (`aggregate_id` is the session ID); `EventV2.replayAll`
rebuilds the session, messages and inputs in another database and stops when history differs;
replaying into a database without the thread's project row fails, so the engine must create what the
replay needs.

### Contract

`tenon/packages/core/src/thread-sync.ts` exports the namespace `ThreadSync` (the repository's
self-export pattern, importable as `@tenon/core/thread-sync`); supporting files go in
`tenon/packages/core/src/thread-sync/`.

```ts
ThreadSync.generateKey(): { key: Uint8Array; phrase: string }
ThreadSync.keyFromPhrase(phrase: string): Uint8Array

ThreadSync.seal(input: { key: Uint8Array; sessionID: string; previous: string | null; events: ReadonlyArray<EventV2.SerializedEvent> }):
  Promise<{ bytes: Uint8Array; hash: string; first: number; last: number }>
ThreadSync.open(input: { key: Uint8Array; sessionID: string; previous: string | null; bytes: Uint8Array }):
  Promise<{ events: EventV2.SerializedEvent[]; hash: string; first: number; last: number }>

type ThreadSync.Store = {
  get(name: string): Promise<{ bytes: Uint8Array; generation: string } | undefined>
  put(name: string, bytes: Uint8Array, options?: { ifGeneration?: string | null }): Promise<{ generation: string }>
  list(prefix: string): Promise<Array<{ name: string; generation: string; size: number }>>
  remove(name: string): Promise<void>
}
ThreadSync.folderStore(directory: string): ThreadSync.Store
ThreadSync.gcsStore(input: { bucket: string; token: () => Promise<string>; endpoint?: string; prefix?: string }): ThreadSync.Store

ThreadSync.make(input: {
  db: Database.Interface["db"]; events: EventV2.Interface; store: ThreadSync.Store
  key: Uint8Array; machine: { id: string; name: string }
}): {
  push(sessionID: string): Effect.Effect<{ uploaded: number; head: number }, ThreadSync.SyncError>
  pull(sessionID: string): Effect.Effect<{ applied: number; head: number }, ThreadSync.SyncError>
  takeOver(sessionID: string): Effect.Effect<{ applied: number; head: number }, ThreadSync.SyncError>
  list(): Effect.Effect<Array<{ sessionID: string; head: number; owner: { id: string; name: string }
    updatedAt: number; directory: string; title: string }>, ThreadSync.SyncError>
  remove(sessionID: string): Effect.Effect<void, ThreadSync.SyncError>
}
```

`ThreadSync.SyncError` is an error with a string `code`. The promise functions reject with it (or throw
it, for `keyFromPhrase`); the engine's effects fail with it in the error channel, not as a defect. Codes:
`invalid_key`, `invalid_segment`, `unreadable`, `invalid_name`, `conflict`, `unauthorized`,
`unavailable`, `not_found`, `not_owner`, `diverged`, `foreign_path`, `unsupported`.

### Acceptance criteria

- **AC-P4-1 Keys.** A generated key is 32 random bytes; its phrase gives the same key back, also with
  surrounding white space; anything else is `invalid_key`. A key that is not 32 bytes is `invalid_key`
  wherever it is used.
- **AC-P4-2 Segments.** `seal` encrypts a run of one thread's events with authenticated encryption and a
  fresh nonce, so two seals of the same input differ and no event text is readable in the bytes. `hash`
  is the lower-case hex SHA-256 of `bytes`; `first` and `last` are the first and last sequence numbers.
  `open` returns the same events. A segment is bound to its thread and to `previous` (the hash of the
  segment before it, `null` for the first), so segments open only in order. Events must be non-empty,
  of the given thread and of consecutive sequence numbers, else `invalid_segment`.
- **AC-P4-3 Unreadable.** `open` fails with `unreadable` for another key, a changed, truncated or empty
  input, another `sessionID` or another `previous`.
- **AC-P4-4 Stores.** `get` of a missing name is `undefined`. `put` with `ifGeneration: null` writes only
  when the name is free, with a generation only when that is the current generation, and without the
  option always; a failed condition is `conflict`. Every write gives a new generation. `list` returns the
  names under a prefix sorted by name with their generation and byte size. `remove` of a missing name
  succeeds. A name is one or more `/`-separated parts of `A-Z a-z 0-9 . _ -`, none of them `.` or `..`;
  anything else is `invalid_name` on every method (for `list`, the prefix may end in `/`) and touches
  nothing. Two `folderStore`s on one directory see each other's writes.
- **AC-P4-5 Cloud Storage.** (Superseded by P4b; kept as history.) `gcsStore` uses the Cloud Storage JSON API at `endpoint` (default
  `https://storage.googleapis.com`) with `Authorization: Bearer <token>` from `token()` on every request:
  `GET /storage/v1/b/<bucket>/o/<name>?alt=media` (generation from the `x-goog-generation` header, 404 is
  `undefined`), `POST /upload/storage/v1/b/<bucket>/o?uploadType=media&name=<name>` with
  `ifGenerationMatch=<generation>` (`0` for "must not exist"; 412 is `conflict`),
  `GET /storage/v1/b/<bucket>/o?prefix=<prefix>` following `nextPageToken`, and
  `DELETE /storage/v1/b/<bucket>/o/<name>` (404 is fine). Object names in the path are percent-encoded,
  slashes included. With `prefix`, objects are stored under it and names come back without it. 401 and
  403 are `unauthorized`; a network failure or a 5xx after the store's own retries is `unavailable`. The
  retries of one call take at most two seconds in total, and no single request waits longer than
  fifteen seconds.
- **AC-P4-6 Push and pull.** `push` uploads the events the store does not have yet as a sealed segment
  and returns how many (`0` and no write when up to date) and the head sequence; the first push makes
  this machine the owner. `pull` applies the events this computer lacks through the event log's replay,
  into a database that has never seen the thread or its project, and returns how many; afterwards the
  thread reads through `SessionStore` like a local one and can be prompted. Both work across new engine
  instances and reopened databases. A thread with no local events (`push`) or no stored copy (`pull`) is
  `not_found`; a wrong key is `unreadable` and changes nothing locally. A thread whose folder is a path this
  operating system cannot hold (a Windows drive path on macOS) fails with `foreign_path` before anything
  local changes; mapping it to a local folder is P5's job. A pull is all or nothing: if any stored event
  cannot be applied here (a type this version does not know, data that fails its schema, or a replay
  that fails for any other reason), `pull` and `takeOver` fail with `unsupported`, no event of that pull
  stays in the local log and the local owner is unchanged. `diverged` means only that a local event
  differs from the stored one at the same sequence.
- **AC-P4-7 Ownership.** Only the owner pushes; anyone else gets `not_owner`. `takeOver` pulls to the
  head, then makes this machine the owner with a conditional write, and is a no-op for the owner. If
  this computer's log holds an event at a sequence where the stored thread has a different one, `pull`
  and `takeOver` fail with `diverged` and the local log and ownership stay as they were.
- **AC-P4-8 At rest.** Everything the engine stores is under `threads/<sessionID>/`. Names hold only the
  session ID and sequence numbers or hashes. All contents are sealed with the key, the manifest included
  (owner, title, directory), so no prompt text, path, machine ID or machine name is readable in the
  store. Every `put` the engine makes carries `ifGeneration` (`null` for a new object).
- **AC-P4-9 List and remove.** `list` returns every stored thread, newest `updatedAt` first, where
  `updatedAt` is the time in epoch milliseconds of the last push that uploaded events, `directory` is the
  thread's folder on the computer that pushed it and `title` its title. `remove` deletes the stored copy
  (never the local thread) and is `not_owner` for anyone but the owner.
- **AC-P4-10 Documentation.** `docs/architecture/README.md` gains a "Thread sync" section with an SVG in
  `docs/diagrams/`; `docs/architecture/uml.md` gains the subsystem in its coverage index;
  `docs/security/threat-model.md` gains a section saying what is encrypted, what a bucket reader still
  learns (session IDs, sizes, timing, count), where the key is expected to live and what losing it means.
  No source comments. Nothing outside the P4 edit scope changes.

- **AC-P4-11 Robust against a flaky or rolled-back store** (added after review panel round 1; a reviewer's
  probes found these, no earlier criterion covered them).
  - A write whose reply is lost does no harm. If the manifest write reaches the store but the engine sees
    a failure, the stored thread stays readable and complete: the engine removes the segment it just
    wrote only when the store definitely refused the manifest write (a `conflict`) and a re-read shows
    the segment is not listed. After any other failure (a timeout, a dropped connection, `unavailable`)
    it cannot tell whether the write will still land, so it leaves the segment; an orphan costs nothing. The next `push` then succeeds or reports up to date truthfully, and a `pull` on
    another computer applies every event.
  - A stored copy that is behind this computer changes nothing here. When the stored head is lower than
    the local log's, `pull` applies nothing and does not change the local owner.
  - `gcsStore` treats a success reply it cannot parse as `unavailable` on every method (a listing never
    comes back empty because its body was malformed), stops with `unavailable` when a listing repeats a
    page token or runs past 1,000 pages, and counts the time `token()` takes inside the same limits.
  - The threat model says plainly what someone who can write to the store without the key can still do:
    delete objects, and put back an older genuine manifest, which can hand the lock back to a previous
    owner and let two computers continue from the same point; the engine reports that later as
    `diverged`, and each computer keeps its own copy.

Known limit, recorded rather than solved here: files an event only points to (the tool-output store,
image blobs) are not synced. P5 decides what to do about them.

The acceptance tests import `effect`, which resolves only inside the package. They are kept in
`implementations/mobile-sync-programme/acceptance/p4/` and the implementor copies both files unchanged
to `tenon/packages/core/test/thread-sync/` as its first step and commits them there.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P4-1 to 8 | `acceptance/p4/acceptance.test.ts` (main flows) | `verification/p4/verification.test.ts` (chains, bad segments, unsafe names, paging, error codes, restart, divergence, conditional writes, leaks through Cloud Storage) |
| AC-P4-9 | stated here | `verification/p4/verification.test.ts` |
| AC-P4-10 | diff review | diff review |

Commands, from `tenon/packages/core`: `bun test test/thread-sync` and, in the verifier's checkout after
copying `verification.test.ts` and `verification-gcs-fake.ts` into `test/thread-sync/`, the same command.
Standard checks: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test:engine`.
Baseline: on the base commit the acceptance file fails at the import of `../../src/thread-sync`.

Superseded by P4b (2026-11-27): the store is Google Drive, not Cloud Storage. `gcsStore`, its fake and
its tests are removed. AC-P4-5 no longer applies; its place is taken by AC-P4b-1 to 8. The engine
cases of `acceptance/p4/acceptance.test.ts` (AC-P4-6 to 8) now run against both `folderStore` and
`driveStore`, and its AC-P4-5 case is replaced by a pointer to the P4b set.

## P4b: Google Drive store

The user clarified on 2026-11-27 that thread sync stores to Google Drive, not Google Cloud Storage:
personal use, one Google account, two or more of the user's own computers. A later message the same day
asked for a folder the user can see in My Drive instead of the hidden application data folder. The
engine (P4) is unchanged: it already encrypts everything it stores and depends only on the Store
contract.

Before: `ThreadSync.gcsStore({ bucket, token })` writes objects with `ifGenerationMatch`; the manager
needs a bucket name. After: `ThreadSync.driveStore({ token, folder? })` keeps the same Store contract on
top of Google Drive v3 in a folder called "Tenon Workbench Threads" in the user's My Drive; the manager
needs no setting beyond `enabled` and the computer name.

### What Google Drive gives, and what it does not

Checked on 2026-11-27 against the Drive v3 documentation (files resource, `files.list`, uploads, search
terms, error handling, custom properties, scopes):

- `files.create` (`POST /upload/drive/v3/files?uploadType=multipart`, metadata part first, then the
  media, up to 5 MB) gives every file an ID. Names are not unique ("This isn't necessarily unique within a
  folder"). There is no write precondition like Cloud Storage's `ifGenerationMatch`.
- `appProperties` are "private to the requesting app": the user cannot see or change them in the Drive
  web page. A key and value together take at most 124 bytes; an app may set 30 per file. They can be
  searched with `appProperties has { key='…' and value='…' }`.
- `files.list` takes `q`, `spaces` (`drive` or `appDataFolder`), `pageSize` up to 1000 and `pageToken`;
  it includes trashed files unless `q` says `trashed = false`; a reply may set `incompleteSearch`.
- `createdTime` is set by Drive when the client does not send one; `trashed` is true for a file in the
  bin, also through a trashed parent folder. `files.delete` removes a file the user owns for good.
- Errors: 401 `authError`; 403 with reason `rateLimitExceeded` or `userRateLimitExceeded` and 429 and
  5xx are to be retried with backoff; other 403 reasons (`insufficientFilePermissions`,
  `appNotAuthorizedToFile`, `storageQuotaExceeded`, …) are not.
- Scope `https://www.googleapis.com/auth/drive.file` gives per-file access to the files the app created
  or the user opened with it (`isAppAuthorized`: "created or opened by the requesting app"). The
  documentation ties this to the user and the app's OAuth client, not to a device, but does not say in
  so many words that a second installation sees the first one's files. **Assumption, to be confirmed
  with a real account in P5b:** every computer signs in with the same Tenon OAuth client (one Cloud
  project) and the same Google account, and then sees every file and folder Tenon made on any of them.
  A different OAuth client would see none of them. Files the user puts in the folder themselves, or
  copies of Tenon's files, are not visible to Tenon at all.

### Contract

```ts
ThreadSync.driveStore(input: {
  token: () => Promise<string>
  endpoint?: string
  folder?: string
}): ThreadSync.Store
ThreadSync.DRIVE_FOLDER = "Tenon Workbench Threads"
```

`endpoint` defaults to `https://www.googleapis.com` (both `/drive/v3` and `/upload/drive/v3` live
there). `folder` is the name used when the folder is created, default `ThreadSync.DRIVE_FOLDER`.

Layout. One store name (`threads/<sessionID>/manifest`, `threads/<sessionID>/segment-…`) is a set of
immutable Drive files, its *versions*. Each version carries these `appProperties`:

| Key | Value |
| --- | --- |
| `tenonSync` | `v1` (a folder carries `folder-v1`) |
| `dir` | the name without its last part (`threads/ses_…`), or `.` for a one-part name |
| `base` | the last part (`manifest`, `segment-…`) |
| `parent` | the ID of the version this one replaces, or `-` when the name was absent |
| `writer` | 32 random hex characters chosen by the writing call |
| `sha256` | lower-case hex SHA-256 of the content |

The Drive file name is `Tenon sync - ` and the name's parts joined by ` - ` (for example
`Tenon sync - threads - ses_123 - manifest`): readable enough to recognise, and holding nothing the
store name does not already hold (no title, path or computer name). Tenon never reads the Drive name, so
renaming a file changes nothing.

The winner rule, applied to the versions of one name that are visible, not trashed and well formed:

1. A *root* is a version whose `parent` is `-` or is not among the visible versions.
2. Start at the root created first (by `createdTime`, then by file ID).
3. Move to the child (a version whose `parent` is the current one's ID) created first, until there is
   none. That last version is the winner; its file ID is the generation.

`put(name, bytes, { ifGeneration })`:

1. List the name's versions and compute the winner `W`. `ifGeneration: null` needs no winner; a string
   needs `W`'s ID to be that string; otherwise the call fails with `conflict` and writes nothing.
   Without the option the call is conditional on the current winner and starts again after a lost race,
   at most five times.
2. Create a new version with `parent` = `W`'s ID (or `-`) and a fresh `writer`.
3. List again. If none of the visible versions carries this call's `writer` (the reply was lost, the
   listing is stale), list again after 150, 300 and 600 ms; still none is `unavailable`.
4. If the winner carries this call's `writer`, the call succeeds with that file's ID. Otherwise it
   failed with `conflict`, and it deletes its own versions.
5. After a success it deletes superseded versions: first every version that is not on the path from the
   first root to the winner, then the path's versions from the root down, never the winner. It stops at
   the first failure and never fails the call.

Guarantees, given the freshness assumption below:

- **A write that loses is never reported as a success.** A call succeeds only when, after its own
  version is visible, the rule picks it.
- **A reported success stays the winner until a later write is conditioned on it.** Every version
  created afterwards is created later: one whose parent is on the winning path loses to the earlier
  child at that point; one whose parent is gone becomes a root created later than the first root.
- **`conflict` is definite.** It is answered only when the condition failed before writing, or when
  another version already won; under the same assumption that never changes later, so the engine may
  remove its segment.
- **A lost reply does no harm.** The call finds its version by `writer` and decides as above; if the
  version cannot be found the answer is `unavailable` (the engine treats that as "don't know"). A
  create retried after a lost reply makes a second version with the same `writer`; the rule picks the
  earlier, either way the call's own, and cleanup removes the other.
- **The winner is never deleted** by cleanup, and cleanup removes losers before the path, so a cleanup
  that stops partway leaves the same winner.

Limits, said plainly:

- **Freshness assumption.** The guarantees hold when a `files.list` made after a `files.create`
  returned shows every version created before it. Drive documents no such promise. If a listing misses
  a version that was created earlier, two calls can both report success; the engine then sees a thread
  whose history differs and reports `diverged`, and each computer keeps its own copy. Writes of one
  thread come from its owner only, so this needs two computers writing the same thread within a few
  seconds (a takeover racing a push).
- **Clock.** The order comes from Drive's `createdTime`, then the file ID. Two creates in the same
  millisecond are ordered by ID, which is still the same answer for every reader.
- **Reads can be behind.** `get` and `list` show what the listing showed; a stale listing gives an older
  winner, and the next conditional write then fails with `conflict` as it should.
- **Cost.** A write is two listings and one create, plus deletes; `list` reads every Tenon file in the
  Drive (1000 per page). That suits one person's threads, not thousands of computers.
- Anyone holding the token can delete versions or roll a name back (see the threat model), as before.

Folder. Tenon looks for folders (`mimeType = 'application/vnd.google-apps.folder'`) carrying
`tenonSync = folder-v1`, not in the bin. It writes into the one whose name equals `folder`, else the
first created, then the lowest ID. Reads and listings do not depend on the folder: they find every
version Tenon made anywhere in My Drive that is not in the bin, so two computers that each created a
folder never split the data, and a folder or file the user renamed or moved keeps working. `get`,
`list` and `remove` never create a folder; the first write does, in the root of My Drive. When the
folder is trashed, everything in it is in the bin, so reads find nothing (an engine `pull` is
`not_found`) and the next write creates a new folder. Tenon never deletes a folder.

Content. `get` downloads the winner (`GET /drive/v3/files/<id>?alt=media`) and compares its length and
SHA-256 with the version's `size` and `sha256`; a file whose content the user edited or replaced is
`unreadable`, and nothing downloaded is trusted without that check and the engine's authenticated
decryption. A download that answers 404 (the version was superseded and removed meanwhile) lists again,
at most three times.

Requests. Every request carries `Authorization: Bearer <token()>`. Listings use `spaces=drive`,
`corpora=user`, `pageSize=1000`, `fields=nextPageToken,incompleteSearch,files(id,name,size,createdTime,appProperties)`
and follow `nextPageToken`. Tenon never changes a file once made: no `PATCH`, no `PUT`, and no request to
`appDataFolder`.

### Acceptance criteria

- **AC-P4b-1 Drive requests.** `driveStore` calls only the endpoints above at `endpoint`, with the
  bearer token from `token()` on every request; files are created with a multipart upload into the
  chosen folder; listings name `spaces=drive` and `trashed = false`; no request names
  `appDataFolder`, and no request uses `PATCH` or `PUT`. Drive names are `Tenon sync - <parts>`.
- **AC-P4b-2 Store contract.** The rules of AC-P4-4 hold for `driveStore`: `get` of a missing name is
  `undefined`; `put` with `ifGeneration: null` writes only when the name is free, with a generation only
  when it is the winner, and without the option always (a lost race is retried); a failed condition is
  `conflict`; every write gives a new generation; `list` returns names under a prefix sorted by name with
  generation and byte size; `remove` of a missing name succeeds and removes every version; an unsafe name
  is `invalid_name` on every method and sends nothing. A name whose directory or last part is longer than
  100 characters is also `invalid_name`.
- **AC-P4b-3 Folder.** Before the first write no folder is created. The first write creates one folder,
  named `folder` (default "Tenon Workbench Threads"), in the root of My Drive. Writes go to the folder
  chosen by the rule above; versions in any Tenon folder, or moved out of it, are read; a renamed folder
  keeps being used; with the folder in the bin, reads see nothing and the next write creates a new
  folder. A new store instance (a restart) sees everything an earlier one wrote.
- **AC-P4b-4 Conditional writes on Drive.** With two writers interleaved so that both pass step 1
  before either creates, exactly one succeeds, the other gets `conflict`, and `get` returns the winner's
  bytes. A create whose reply is lost after it landed (one or every attempt) ends in success, never
  `conflict`. A stale listing once, at step 1 or step 3, never yields a wrong success or a wrong
  `conflict`. A write that lands late, after other writes and their cleanup, never displaces a reported
  winner. A create that never lands is `unavailable` and leaves nothing.
- **AC-P4b-5 Cleanup.** After a run of successful writes to one name with no race, exactly one version
  of it is visible, and it holds the last bytes. Cleanup never deletes the winner, and a delete that
  fails does not fail the write.
- **AC-P4b-6 Files the user can see and touch.** A renamed or moved version is still read. A version
  whose content was edited or replaced is `unreadable` on `get`, and an engine `pull` of a thread whose
  manifest or segment was edited is `unreadable`. A trashed version is ignored. Files Tenon did not make
  are ignored. Drive names and the folder name hold no thread title, path, prompt text or computer name.
- **AC-P4b-7 Errors.** 401 is `unauthorized`; 403 `rateLimitExceeded` or `userRateLimitExceeded`, 429
  and 5xx are retried within two seconds per request and then `unavailable`; 403 `storageQuotaExceeded`
  is `unavailable`; any other 403 is `unauthorized`; a `token()` that fails is `unauthorized` and its
  time counts inside the limits; a network failure, a request over fifteen seconds, a listing reply that
  cannot be read, `incompleteSearch: true`, a listing that repeats a page token or runs past 1,000 pages
  are `unavailable`. A create reply that cannot be read is treated like a lost reply (AC-P4b-4); a
  create refused with a status that is not retried means nothing was written and answers at once. A
  download whose bytes do not match the version is `unreadable` (AC-P4b-6). A listing split over pages
  is read whole.
- **AC-P4b-8 The engine on Drive.** The P4 engine scenarios hold with `driveStore` on the fake Drive:
  push and pull across two computers (AC-P4-6), takeover (AC-P4-7), nothing readable stored, in file
  contents, Drive names or `appProperties` (AC-P4-8), and a lost reply to the manifest write keeping the
  thread complete (AC-P4-11). With the Tenon folder in the bin, `pull` is `not_found` and the next
  `push` stores the thread again.
- **AC-P4b-9 Cloud Storage removed.** `ThreadSync.gcsStore` no longer exists; no source, test or current
  document mentions Cloud Storage or a bucket for thread sync, except the plan's history, tests that check
  `gcsStore` is gone, and the sentences that say an old settings file's `bucket` is ignored (AC-P4b-10).
- **AC-P4b-10 Manager without a bucket.** The settings file holds `enabled`, an optional `driveFolder`,
  the machine and the folder choices. `status()` answers `driveFolder` (the saved name or
  `ThreadSync.DRIVE_FOLDER`) and `missing` lists only `key` and `store`. `configure({ driveFolder })`
  accepts 1 to 100 characters after trimming with no control characters (stored trimmed), else
  `invalid_name`, and saves nothing on failure. `credentials.store(driveFolder)` is asked for the store. A
  settings file written before this change, holding `bucket`, loads without error, keeps its machine ID,
  and drops `bucket` the next time it is saved. The `/api/thread-sync` status and configure bodies follow
  (`driveFolder` instead of `bucket`), and the generated client is current. The bridge's `sync_token`
  answers an access token carrying `https://www.googleapis.com/auth/drive.file`.
- **AC-P4b-11 Documentation.** The "Thread sync" sections of `docs/architecture/README.md` and
  `docs/security/threat-model.md` describe Drive: the folder, the version layout and winner rule, the
  guarantees and the freshness limit, and what each party can see and do (Google; the user; anyone the
  folder is shared with; a holder of the token). `docs/architecture/uml.md`, the diagrams in
  `docs/diagrams/` and `implementations/mobile-sync-programme/diagrams/` and `docs/deferred-work.md`
  follow. No source comments.

### Test sets

The fake Drive (`acceptance/p4b/drive-fake.ts`) is a local HTTP server that speaks the parts of Drive v3
the store uses, checks the bearer token and the query, and can hold a create until released, lose a
create's reply after it landed, return a stale listing, page listings, repeat a page token, answer
malformed bodies and given statuses with Drive's error body, and act as the user (rename, move, edit,
trash, delete, upload a file of their own). It models `drive.file` by listing only files Tenon created.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P4b-1 to 7 | `acceptance/p4b/drive.test.ts` with `drive-fake.ts` | `verification/p4b/verification.test.ts` with its own fake (`verification-drive.ts`): many writers, a late straggler after cleanup, every create reply lost, creates that never land, a 404 between listing and download, a deleted folder, two folders with competing first versions, equal creation times, Unicode folder names |
| AC-P4b-8 | `acceptance/p4b/drive.test.ts` and `acceptance/p4/acceptance.test.ts` (engine cases over both stores) | `verification/p4b/verification.test.ts` (edited segment, trashed segment, trashed folder) |
| AC-P4b-9 | `acceptance/p4b/drive.test.ts` (no `gcsStore`) and a search of the tree | diff review |
| AC-P4b-10 | `acceptance/p4b/drive.test.ts`, the changed P5a tests | `verification/p4b/verification.test.ts` (old settings file, field limits) |
| AC-P4b-11 | diff review | diff review |

The acceptance files import `effect` and are copied unchanged to `tenon/packages/core/test/thread-sync/`
(`drive.test.ts` is copied as `drive-acceptance.test.ts`, the fake as `drive-fake.ts`). In this
single-agent run one author wrote the plan, both sets and the code; the verification set is kept
outside the repository and is not independent.

Commands, from `tenon/packages/core`: `bun test test/thread-sync`; for the verification set, copy
`verification.test.ts` and `verification-drive.ts` into `test/thread-sync/`, run the same command and
delete the copies. Route and contract checks: `bun test` in `tenon/packages/protocol`,
`bun test test/server/httpapi-thread-sync.test.ts` in `tenon/packages/tenon`, then `bun run test:engine`
and `bun run check` from the root.

### P5a tests changed by this contract

The P5a acceptance file asserts the bucket. Only the assertions the contract change makes wrong are
changed, in both `acceptance/p5a/manager.test.ts` and its copy in `core/test/thread-sync/`:

| Test | Was | Now | Criterion |
| --- | --- | --- | --- |
| AC-P5a-1 | `bucket: ""` at first, `missing` contains `bucket`, `configure({ bucket: "Not A Bucket" })` is `invalid_name`, configure with `bucket: "my-threads"`, the file holds the bucket | `driveFolder: "Tenon Workbench Threads"` at first, `missing` does not contain `bucket`, `configure({ driveFolder: "   " })` is `invalid_name`, configure with `driveFolder: "My threads"`, the file holds it | AC-P4b-10 replaces the bucket check of AC-P5a-1 |
| all | `credentials.store(bucket)` gives a folder store per bucket; `ready` configures `bucket: "my-threads"` | `credentials.store(driveFolder)` gives a folder store per Drive folder name; `ready` configures `enabled: true` only | AC-P4b-10 |
| AC-P5a-2 | `configure({ enabled: true, bucket: "my-threads" })` | `configure({ enabled: true })` | AC-P4b-10 |

AC-P5a-1 now reads: the file holds `enabled`, an optional `driveFolder`, the machine and the folder
choices, and `configure` validates `driveFolder` as AC-P4b-10 says instead of a bucket name.

## P5 and P6, split into a core half and an app half

P5 (thread sync in the app) and P6 (remote access for the phone) each have a half that can be built
and tested without the desktop window, and a half that needs it. The core halves run as a pair, then
the app halves.

| Part | Outcome | Edit scope |
| --- | --- | --- |
| P5a | A sync manager in the server: settings, the list of stored threads with their local state, push after a thread goes idle, and "continue here" with a local folder | `tenon/packages/core/src/thread-sync/` (new files, plus additive exports in `thread-sync.ts`), `tenon/packages/core/test/thread-sync/`, a new route group in `tenon/packages/protocol/src/groups/` and `tenon/packages/server/src/handlers/` with its lines in `protocol/src/api.ts` and `server/src/handlers.ts`, the generated client, docs |
| P6a | Device pairing, per-device tokens and a companion scope enforced by the server | `tenon/packages/core/src/remote-access.ts` and `src/remote-access/`, `tenon/packages/core/test/remote-access/`, `tenon/packages/server/src/auth.ts` and `middleware/`, `tenon/packages/tenon/src/server/` (authorization middleware, network guard, a pairing route), their tests, docs |
| P5b | Google sign-in for Google Drive (Tenon's own OAuth client, scope `drive.file`), the key in the system credential store, Settings › Sync, and "Continue here" in the app | `tenon/packages/desktop/src/main`, `tenon/packages/app/src` |
| P6b | The second listener, pairing by QR code and device management in Settings › Servers | `tenon/packages/desktop/src/main`, `tenon/packages/app/src` |

P5a's base is the integration branch with P4 merged. Where both core halves must touch the same
registration file (`protocol/src/api.ts`, `server/src/handlers.ts`, the generated client), each adds
only its own lines; the generated client is regenerated at integration.

### P5a: sync manager

#### Contract

`tenon/packages/core/src/thread-sync/manager.ts`, exported from the `ThreadSync` namespace:

```ts
ThreadSync.manager(input: {
  db: Database.Interface["db"]; events: EventV2.Interface
  settingsFile: string
  credentials: { key(): Promise<Uint8Array | undefined>; store(driveFolder: string): Promise<ThreadSync.Store | undefined> }
  projects: { resolve(directory: string): Promise<{ id: string; worktree: string }> }
  hostname: string
}): {
  status(): Effect<Status>
  configure(change: { enabled?: boolean; driveFolder?: string; machineName?: string }): Effect<Status, SyncError>
  threads(): Effect<Array<StoredThread>, SyncError>
  push(sessionID: string): Effect<{ uploaded: number; head: number }, SyncError>
  pull(sessionID: string): Effect<{ applied: number; head: number }, SyncError>
  continueHere(sessionID: string, input: { directory: string }): Effect<{ applied: number; head: number }, SyncError>
  settled(sessionID: string): Effect<{ pushed: boolean; reason?: string }>
  remove(sessionID: string): Effect<void, SyncError>
}
type Status = { ready: boolean; enabled: boolean; driveFolder: string; machine: { id: string; name: string }
  missing: Array<"key" | "store">; lastError: string | null }
type StoredThread = { sessionID: string; title: string; directory: string; head: number; updatedAt: number
  owner: { id: string; name: string }; mine: boolean
  local: "absent" | "behind" | "current" | "ahead" | "diverged"; folder: string | null }
```

New error code: `not_ready` (sync is off, or the key or store is missing).

The contract above was changed by P4b on 2026-11-27: `bucket` became the optional `driveFolder` and
`missing` lost `bucket`. The criteria below keep their original wording where it is history; AC-P4b-10
says what replaced the bucket rules.

#### Acceptance criteria

- **AC-P5a-1 Settings.** `settingsFile` is a JSON file the manager creates on first use, written through
  a temporary file and a rename. It holds `enabled`, `bucket`, the machine (`id` made once from the
  hostname plus six random hex characters, and a `name` that defaults to the hostname) and the folder
  choices; it never holds the key or a token. A file that cannot be parsed is renamed aside and
  defaults are used. `configure` validates the bucket name (3 to 63 characters of lower-case letters,
  digits, `-`, `_` and `.`, starting and ending with a letter or digit) and a machine name of 1 to 64
  characters after trimming (stored trimmed), else `invalid_name`. `status().missing` lists what is absent, and `ready` is
  true only when sync is enabled and nothing is missing.
- **AC-P5a-2 Not ready.** `threads`, `push`, `pull`, `continueHere` and `remove` fail with `not_ready`
  when `ready` is false, and touch neither the store nor the database. `settled` never fails: it returns
  `{ pushed: false, reason }`.
- **AC-P5a-3 Stored threads with local state.** `threads` returns every stored thread, newest first,
  with `mine` (this machine owns it) and `local`: `absent` (no local events), `behind` (the store has
  more), `current` (equal), `ahead` (this computer has more and the same history up to the stored
  head), `diverged` (a local event differs from the stored one at the same sequence). `folder` is the
  local folder chosen for it, or null.
- **AC-P5a-4 Push after a turn.** `settled(sessionID)` pushes when sync is ready and the thread is either
  owned by this machine or not stored yet, and reports `pushed: false` with a reason otherwise (owned by
  another computer, nothing new, not ready, or a store failure, which it records as `status().lastError`
  instead of failing; a later successful push clears it).
- **AC-P5a-5 Continue here.** `continueHere(sessionID, { directory })` takes the thread over (pulling
  first) and records `directory` as this computer's folder for it. From then on, on this computer only,
  the thread's session row has that directory and the project `projects.resolve` names for it (creating
  the project row when it is new), so the thread is listed under that folder and its next turn runs
  there. The choice survives later pulls and a new
  manager on the same files (it is re-applied after every pull, including one that applies nothing), is
  never written to the event log, and does not change the thread's folder on any other computer; the
  stored manifest's `directory` keeps meaning the folder on the computer that last pushed. A failed
  `continueHere` records nothing. A relative or empty
  `directory` is `invalid_name`. Continuing a thread this computer already owns only records the folder.
- **AC-P5a-6 Routes.** A new group serves the manager under `/api/thread-sync`: `GET` (status), `PUT`
  (configure), `GET /threads`, `POST /threads/:sessionID/push`, `/pull`, `/continue` (body
  `{ directory }`) and `DELETE /threads/:sessionID`. Handlers are thin. A `SyncError` answers with its
  code in the body and a fitting status (409 for `conflict`, `not_owner` and `diverged`; 404 for
  `not_found`; 400 for `invalid_name`; 412 for `not_ready`; 502 for `unavailable` and `unauthorized`;
  422 for `unreadable`, `unsupported` and `foreign_path`). The server's credentials come from the
  desktop over the existing loopback bridge (two bridge calls, never listed as agent tools); without a
  bridge the status is `missing: ["key", "store"]` and nothing else works. The server calls `settled`
  when a thread becomes idle. The generated client is current (`bun run check:generated`).
- **AC-P5a-7 Documentation.** The architecture section gains the manager, the settings file, the routes
  and the folder choice; the threat model says the key and token live only in memory in the server
  process and what the settings file holds; `docs/deferred-work.md` records that a Windows thread
  cannot be continued on macOS yet. No source comments.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P5a-1 to 5 | `acceptance/p5a/manager.test.ts` | `verification/p5a/manager.test.ts` |
| AC-P5a-6 | the implementor's route test | reading the handlers; `bun run check:generated` |
| AC-P5a-7 | diff review | diff review |

### P6a: remote access core

#### Contract

`tenon/packages/core/src/remote-access.ts` exports the namespace `RemoteAccess`:

```ts
RemoteAccess.registry(input: { file: string; now?: () => number }): {
  pairingCode(): { code: string; expiresAt: number }
  pair(input: { code: string; name: string }): Promise<{ id: string; name: string; token: string }>
  authenticate(token: string): Promise<{ id: string; name: string } | undefined>
  devices(): Promise<Array<{ id: string; name: string; createdAt: number; lastSeenAt: number | null }>>
  revoke(id: string): Promise<boolean>
}
RemoteAccess.allows(request: { method: string; path: string }): boolean
```

`pair` rejects with an error whose `code` is `bad_code`, `expired`, `locked` or `invalid_name`.

#### Acceptance criteria

- **AC-P6a-1 Pairing codes.** A code is eight characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, made
  with the system's secure random source, valid for five minutes and for one use. Asking for a new code
  cancels the previous one. Matching ignores case, spaces and hyphens. After five wrong attempts the
  current code is cancelled and `pair` answers `locked` until a new code is made; an attempt with no
  current code is `bad_code`; a code past its time is `expired`. Codes are never written to disk.
- **AC-P6a-2 Devices.** A successful `pair` creates a device with a random ID, the given name (1 to 64
  characters after trimming, else `invalid_name`) and a 32-byte random token returned once. `file` stores
  only the SHA-256 of each token, written through a temporary file and a rename and private to the
  user. Devices survive a new registry on the same file; a file that cannot be parsed is renamed aside
  and treated as empty. `authenticate` finds a device by its token without leaking timing and records
  when it was last seen (at most one write a minute per device); a revoked or unknown token is
  `undefined`. `revoke` removes the device and reports whether it existed.
- **AC-P6a-3 Companion scope.** `allows` is a default-deny list over method and path (query strings
  ignored, a trailing slash tolerated, both the `/api/...` routes and the older instance routes). Allowed
  for a device: reading threads and their messages, creating a thread, prompting, steering, interrupting,
  answering permission requests and questions, the event streams, health, model and harness lists (read),
  the vault's pages, timelines and logs (read and write), calendar (read and write), the Command Centre,
  project threads and usage (read). Denied: terminals and their sockets, the session shell and command
  routes, file content writes and file search outside the vault routes, configuration, credentials,
  provider and MCP sign-in, harness setup, sign-in, install, upgrade and registry changes, computer use,
  workspace instructions writes, project scan, link and unlink, thread sync settings, device management
  and pairing-code creation, dispose and upgrade. The full table lives in `docs/security/threat-model.md`,
  and a test checks that every route the server registers is in exactly one of the two lists.
- **AC-P6a-4 Enforcement.** The authorization middleware accepts `Authorization: Bearer <device token>`
  beside the existing password. A device request outside the scope answers 403 with nothing done; an
  unknown or revoked token answers 401. A device token in a query string is refused: tokens travel in
  the header only, except for the event-stream and socket routes that cannot set a header, where a
  short-lived ticket is used as terminals already do. The password keeps working exactly as before.
  `POST /remote/pair` is the one unauthenticated route: body `{ code, name }`, answers the token once,
  and is limited to ten attempts a minute per address. The owner manages devices through
  `POST /api/remote/pairing-code`, `GET /api/remote/devices` and `DELETE /api/remote/devices/:id`, which a
  device token can never call. Paths are matched exactly as registered: a different letter case, a
  doubled slash, an encoded or literal `..` segment, or a backslash is denied.
- **AC-P6a-5 Documentation.** The threat model gains remote access: the device registry, pairing, the
  scope table, what a stolen phone can do until revoked, and that the link is plain HTTP on a network
  the user trusts (local network or VPN) until a later phase adds a relay. No source comments.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P6a-1, 2, 3 | `acceptance/p6a/remote-access.test.ts` | `verification/p6a/remote-access.test.ts` |
| AC-P6a-4 | the implementor's HTTP tests, modelled on `tenon/test/server/httpapi-authorization.test.ts` | reading the middleware; the verifier's own requests |
| AC-P6a-5 | diff review | diff review |

### P5b: thread sync in the desktop app

One agent (TOR-1, no subagents) wrote this section, both test sets and the code. The review panel is a
scored self-review in three lenses (plan conformance, correctness and regressions, integrity and scope).

Before: the server's sync manager asks the desktop for `sync_key` and `sync_token` over the loopback
bridge, and the bridge answers "Unknown tool", so `status().missing` is always `["key", "store"]`; there is
no Settings page, no Google sign-in for Drive and no way to continue a thread here.

After: Settings › Sync signs in to Google Drive in the system browser with the user's own OAuth client,
keeps the refresh token and the sync key in the operating system's credential store through Electron
`safeStorage`, shows a new key's recovery phrase once or takes a phrase from another computer, turns sync on,
names the Drive folder and this computer, lists the stored threads with their state, and continues a thread
owned by another computer in a folder the user picks.

#### Contract

`tenon/packages/desktop/src/main/thread-sync/` holds the domain code; `ipc.ts` only forwards.

```ts
googleSignIn(input: {
  clientId: string; clientSecret: string; scope: string
  endpoints: { authorize: string; token: string }
  openExternal(url: string): Promise<void>; fetch: typeof fetch
  signal?: AbortSignal; timeoutMs?: number
}): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; scope: string }>

encodePhrase(key: Uint8Array): string
decodePhrase(phrase: string): Uint8Array   // throws Error("invalid_phrase")

createThreadSyncService(input: {
  secrets: { available(): Promise<boolean>; encrypt(value: string): Promise<string>; decrypt(value: string): Promise<string> }
  store: { get(key: string): unknown; set(key: string, value: unknown): void; delete(key: string): void }
  fetch: typeof fetch; openExternal(url: string): Promise<void>
  endpoints?: { authorize: string; token: string; revoke: string }
  now?: () => number; random?: (size: number) => Uint8Array
}): {
  status(): Promise<ThreadSyncDesktopStatus>
  setClient(input: { clientId: string; clientSecret: string }): Promise<ThreadSyncDesktopStatus>
  signIn(): Promise<ThreadSyncDesktopStatus>
  cancelSignIn(): void
  signOut(): Promise<ThreadSyncDesktopStatus>
  createKey(): Promise<{ phrase: string; status: ThreadSyncDesktopStatus }>
  enterPhrase(phrase: string): Promise<ThreadSyncDesktopStatus>
  forgetKey(): Promise<ThreadSyncDesktopStatus>
  bridge(route: "sync_key" | "sync_token"): Promise<{ text: string }>
}
type ThreadSyncDesktopStatus = {
  secureStorage: boolean
  clientId: string | null
  signedIn: boolean; signingIn: boolean
  key: boolean
  error: string | null
}
```

`DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"`. Default endpoints are Google's
(`https://accounts.google.com/o/oauth2/v2/auth`, `https://oauth2.googleapis.com/token`,
`https://oauth2.googleapis.com/revoke`). An unpackaged build reads `TENON_THREAD_SYNC_OAUTH_ENDPOINT` (a base URL
whose `/authorize`, `/token` and `/revoke` stand in for Google's) and `TENON_THREAD_SYNC_DRIVE_ENDPOINT` (passed
to the server, which hands it to `driveStore`) so a fake OAuth server and the Drive fake can stand in; a packaged
build ignores both.

#### Acceptance criteria

- **AC-P5b-1 Installed-app sign-in.** `googleSignIn` listens on `127.0.0.1` on a free port, opens the
  authorize URL in the system browser (`openExternal`) with `client_id`, `redirect_uri`
  `http://127.0.0.1:<port>/oauth2/callback`, `response_type=code`, `access_type=offline`,
  `prompt=consent`, `scope` exactly the given scope, a random `state` and a PKCE `code_challenge`
  (S256 of a random 43-character `code_verifier`). The callback with the right `state` and a `code` is
  exchanged at the token endpoint (form body with `grant_type=authorization_code`, the code, the verifier,
  the redirect URI, the client ID and the client secret; Google issues a secret for every Desktop-app client and documents that it is not treated as confidential). A callback with another `state`
  answers 400 and keeps waiting; `error=access_denied` rejects with `google_oauth_denied`; a token
  answer without a refresh token rejects with `google_refresh_token_missing`; a granted `scope` without
  `drive.file` rejects with `google_scope_missing`; the timeout rejects with `google_oauth_timeout` and
  the abort signal with `google_oauth_cancelled`. The listener is closed on every outcome. The browser
  page says only that sign-in finished or failed.
- **AC-P5b-2 Credentials at rest.** The service stores in the desktop store only: the client ID, the
  encrypted client secret, the encrypted refresh token and the encrypted sync key (each through
  `secrets.encrypt`); nothing else, and never a plain token, secret, key or phrase. Without secure
  storage `status().secureStorage` is false and `setClient`, `signIn`, `createKey` and `enterPhrase` reject with
  `secure_storage_unavailable` and store nothing. `setClient` checks the client with the Calendar sign-in's rules (an ID ending in `.apps.googleusercontent.com`, a secret without spaces; `google_client_id_invalid`, `google_client_secret_invalid`), and saving a different client signs out of the old one. `signIn` without a client is `google_client_missing` and opens nothing; a second `signIn` while one is open is `google_operation_busy`; `cancelSignIn` ends it with `google_oauth_cancelled`, which `status().error` then shows. `signOut` revokes the refresh token at the revoke endpoint (a failure
  is ignored) and deletes it; the key stays. `forgetKey` deletes only the key.
- **AC-P5b-3 Key and phrase.** `createKey` makes 32 random bytes, stores them and returns the phrase
  once; it rejects with `key_exists` when a key is stored. `encodePhrase` and `decodePhrase` use the
  core engine's format (eighteen groups of four hex digits: the key and the first four bytes of its
  SHA-256), so a phrase made by `ThreadSync.generateKey` opens here and the reverse; `decodePhrase`
  ignores case and surrounding white space and rejects anything else with `invalid_phrase`.
  `enterPhrase` stores the decoded key, replacing any stored key. No method ever returns the key or the
  phrase except `createKey`'s one answer.
- **AC-P5b-4 Bridge.** `bridge("sync_key")` answers `{ text: JSON.stringify({ key: <base64url> }) }` with
  the stored key, or `{ text: "{}" }` without one. `bridge("sync_token")` answers `{ text:
  JSON.stringify({ token }) }` with an access token for the stored refresh token: the cached one while it
  has more than a minute left, else a fresh one from the token endpoint (`grant_type=refresh_token`); a
  rotated refresh token is stored encrypted. Not signed in, or a refused refresh (`invalid_grant`), answers
  `{ text: "{}" }`, and an `invalid_grant` also deletes the refresh token so the page says to sign in
  again; a token endpoint that cannot be reached answers `{}` and keeps the refresh token. Concurrent requests share one refresh. These answers are what `ThreadSync.bridgeCredentials` (P5a) decodes. The browser bridge routes
  `sync_key` and `sync_token` to the service; they stay outside the agent tool list.
- **AC-P5b-5 Settings › Sync.** A new Settings tab `sync` (desktop only; the web build says it needs the
  desktop app) built from the standard Settings parts shows: Google Drive (client ID and optional secret
  fields with Save, Sign in or Sign out, the state), the sync key (Create a key, which shows the phrase
  once with Copy and "I saved it"; Enter a recovery phrase; Forget), sync itself (on/off, the Drive folder
  name and this computer's name, saved through `PUT /api/thread-sync`; what is still missing; the last
  error), and the stored threads (`GET /api/thread-sync/threads`: title, the owning computer, a state
  word for `local`, "This computer" for `mine`), with "Continue here" on a thread owned by another
  computer, which opens the folder picker and posts `/continue` with the chosen folder. Every string goes
  through i18n; no colour coding. The tab appears in the matrix as `settings:sync`.
- **AC-P5b-6 Thin IPC and platform.** New channels `thread-sync-status`, `thread-sync-set-client`,
  `thread-sync-sign-in`, `thread-sync-cancel-sign-in`, `thread-sync-sign-out`, `thread-sync-create-key`,
  `thread-sync-enter-phrase`, `thread-sync-forget-key` only call the service. Paths: the Electron store
  lives in the user data folder on both systems; `safeStorage` uses DPAPI on Windows and the Keychain on
  macOS; the loopback listener and the system browser are the same on both.
- **AC-P5b-7 Fakes end to end.** With a fake OAuth server and the Drive fake, a test signs in, creates a
  key, and a `ThreadSync.manager` built with `bridgeCredentials` against a bridge that answers from the
  service reports `ready` and pushes a thread to the fake Drive.
- **AC-P5b-8 Documentation.** The architecture's Thread sync section, the threat model (where the key and
  refresh token live, the OAuth client as a user setting, the endpoints overrides only in unpackaged
  builds), `docs/architecture/uml.md`, the diagram, the matrix (`settings:sync`, new channels) and a manual
  test script `docs/records/thread-sync-manual-test.md` for the two unverified assumptions. No source
  comments.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P5b-1 to 4 | `acceptance/p5b/acceptance.test.ts` with `fake-google.ts` (copied unchanged to `tenon/packages/desktop/src/main/thread-sync/`) | `verification/p5b/desktop-verification.test.ts` (client rules, busy and cancelled sign-in, the callback page, random phrases, a broken stored key, an unreachable token endpoint, one shared refresh) |
| AC-P5b-5 | `acceptance/p5b/sync-model.test.ts` (copied as `app/src/components/settings-v2/thread-sync-model.test.ts`) and the page driven in the desktop app | screenshots of the page in the real app against the fakes |
| AC-P5b-6, 8 | diff review, `bun run check` | diff review |
| AC-P5b-7 | | `verification/p5b/core-e2e-verification.test.ts`, copied into `core/test/thread-sync/`: the desktop service, a loopback bridge, `bridgeCredentials` with the Drive fake and a real `ThreadSync.manager` push |

Baseline on `b19e2295` (P0 tip): every new acceptance and verification file fails at its import
(`./oauth`, `./thread-sync-model`), 0 pass.

What the user must supply: a Google Cloud project with the Drive API enabled and an OAuth client of type
"Desktop app" (its client ID, and its client secret, which Google issues for desktop clients and treats as
not secret), entered in Settings › Sync on every computer.

Unverified: the live Google sign-in and Drive; that a second computer signed in through the same client
sees the first one's files under `drive.file`; Drive listing freshness; anything on macOS (Keychain through
`safeStorage` is the same API, untested here).

### P6b: remote access in the desktop app

One agent (TOR-1, no subagents) wrote this section, both test sets and the code; the review panel is a
scored self-review in three lenses.

Before: the server listens on loopback only; P6a's pairing, device tokens and companion scope exist in the
server but nothing outside this computer can reach it, and no page makes a pairing code or lists devices.

After: the owner can turn on a second listener for paired devices on one LAN or VPN address of this
computer. It is a small reverse proxy in Electron main that forwards only device requests to the local
server, where P6a's middleware authenticates them and enforces the companion scope. Settings › Servers
gains Phone access: the switch, the address and port, a plain-HTTP warning, Pair a phone (QR code, the
code and the address) and the paired devices with last seen and Revoke.

#### Contract

`tenon/packages/desktop/src/main/remote-access/`:

```ts
lanAddresses(interfaces: Record<string, Array<{ address: string; family: string | number; internal: boolean }> | undefined>):
  Array<{ address: string; name: string }>
validateRemoteConfig(input: { enabled: boolean; address: string; port: number }, offered: Array<{ address: string; name: string }>):
  { enabled: boolean; address: string; port: number }     // throws remote_address_invalid / remote_port_invalid
startRemoteListener(input: { host: string; port: number; target: () => string }): Promise<{ url: string; stop(): Promise<void> }>
createRemoteAccess(input: { store; interfaces: () => …; listen?: typeof startRemoteListener-like; target?: () => string }): {
  start(): Promise<void>
  status(): Promise<RemoteAccessStatus>
  configure(input: { enabled: boolean; address: string; port: number }): Promise<RemoteAccessStatus>
  stop(): Promise<void>
}
type RemoteAccessStatus = { enabled: boolean; address: string; port: number; addresses: Array<{ address: string; name: string }>
  running: boolean; url: string | null; error: string | null }
```

App: `tenon/packages/app/src/components/settings-v2/remote-access-model.ts` exports
`pairingLink({ url, code })`, `parsePairingLink(link)` and `deviceRows(devices, now)`.

#### Acceptance criteria

- **AC-P6b-1 Off by default.** No second listener until the owner turns Phone access on; the loopback
  server, its password and the bind guard are unchanged whether it is on or off. The choice (on, address,
  port) is saved in the desktop store `tenon.remote-access` and applied at the next start; a saved address
  the computer no longer has is not bound (`remote_address_gone`).
- **AC-P6b-2 Address and port.** Offered addresses are this computer's non-internal interface addresses,
  IPv4 before IPv6, never link-local IPv6 (`fe80::`) or loopback. Only an offered address can be chosen
  (never `0.0.0.0`, `::` or loopback; else `remote_address_invalid`) and a port is an integer from 1024 to
  65535 (default 47100; else `remote_port_invalid`). A refused choice saves nothing. A bind failure is
  reported in `status().error` (for example `EADDRINUSE`) and leaves the listener off.
- **AC-P6b-3 Device requests only.** The listener forwards a request to the local server unchanged (method,
  raw path and query as received, headers except hop-by-hop ones and `Host`, body streamed, response
  streamed so event streams arrive as they are written) only when it carries `Authorization: Bearer
  <non-empty>` and no `auth_token` query, or is `POST /remote/pair`, or is a `GET` with a `ticket` query (the
  event streams). Anything else, including any `Basic` credential and the server password in `auth_token`,
  answers 401 without reaching the server. Socket upgrades (terminal sockets) answer 403. An unreachable
  server answers 502. It adds no `X-Forwarded-*` header. The server's P6a middleware does everything else:
  it authenticates the token and applies the companion scope to the raw path.
- **AC-P6b-4 CORS for the phone app.** Requests and preflights from `capacitor://localhost`,
  `https://localhost` and `http://localhost` (the Capacitor web views) get
  `Access-Control-Allow-Origin` with that origin, the methods and the request headers they ask for;
  preflights are answered by the listener (204) and not forwarded; other origins get no CORS headers.
- **AC-P6b-5 Settings › Servers, Phone access.** A section built from the standard Settings parts: the
  switch (off by default), the address (a select of the offered addresses) and the port, the URL while
  running, the last error, and a warning that the link is plain HTTP for a home network or VPN you trust
  and that a paired phone can read and steer every thread. Pair a phone asks the server for a code
  (`POST /api/remote/pairing-code` with the owner's password) and shows a QR code of
  `tenon://pair?server=<url>&code=<code>`, the code in groups and the address, until it expires.
  Paired devices (`GET /api/remote/devices`) show name, paired and last seen ("Never" when null), newest
  first, each with Revoke (`DELETE /api/remote/devices/:id`). All text through i18n; no colour coding.
- **AC-P6b-6 Thin IPC.** `remote-access-status` and `remote-access-configure` only call the controller.
  The listener starts after the server is ready and stops on quit. Windows: the first bind on a LAN
  address makes Windows Defender Firewall ask whether to allow Electron on private or public networks; the
  page says so. macOS: the application firewall may ask to accept incoming connections. Paths and shells
  play no part.
- **AC-P6b-7 Documentation.** The threat model's Remote access section gains the second listener (what it
  forwards and refuses, CORS, the warnings, firewall prompts) and loses "this is the server half only";
  the architecture section, `docs/architecture/uml.md`, a diagram and the feature matrix follow. No
  source comments.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P6b-1, 2 | `acceptance/p6b/controller.test.ts`, `acceptance.test.ts` (addresses, settings) | `verification/p6b/listener-verification.test.ts` (addresses) |
| AC-P6b-3, 4 | `acceptance/p6b/acceptance.test.ts` (copied with `controller.test.ts` to `tenon/packages/desktop/src/main/remote-access/`) | `verification/p6b/listener-verification.test.ts`: raw sockets, scheme case, bearer with `auth_token`, ticket on POST, raw path, hop-by-hop headers, 3 MB body, streamed events |
| AC-P6b-5 | `acceptance/p6b/pairing-model.test.ts` (copied as `app/src/components/settings-v2/remote-access-model.test.ts`) and the page in the desktop app | screenshots; a real pairing against the running app over the LAN address with the device token |
| AC-P6b-6, 7 | diff review, `bun run check` | diff review |

Baseline on 3a965e13 (P5b tip): see completion evidence.

## P7: phone layout below 600 px

One agent (TOR-1, no subagents) wrote this section, both test sets and the code; the review panel is a
scored self-review in three lenses.

Before (screenshots at 390 x 844 on the base): the 64 px rail and its card stay a left column, leaving
about 300 px for the page; Home's heading is cut off at the right edge and its composer is squeezed; the
thread list cannot be opened at all below 768 px (the panel is `hidden md:flex`); the composer's send button
is 30 px.

After: below 600 px the rail becomes a bottom bar across the screen (Home, Projects, Calendar, Command
Centre, Usage, Threads, Settings), above the bottom safe-area inset; Threads opens the thread list as a
sheet over the page that closes when a thread is opened, on a second tap or on Escape; pages use the whole
width; text that is too long wraps instead of being cut; on a touch screen the send button is 40 px; the
page shrinks with the on-screen keyboard (`interactive-widget=resizes-content`, already in `index.html`) so
the composer stays in view. From 600 px up nothing changes.

### Acceptance criteria

- **AC-P7-1 Fits.** At 390 x 844 with touch, Home, Calendar, the new thread page and a thread have no page
  scroll to the side, and no visible element in the page or the navigation sticks out of the screen
  unless it sits in a container that scrolls sideways on purpose (the calendar's view tabs).
- **AC-P7-2 Bottom bar.** The navigation is one row along the bottom edge, at least 56 px tall and the full
  width; each destination (Home, Projects, Calendar, Command Centre, Threads, Settings; Usage too) is at
  least 44 x 44 px; the page starts at the left edge and ends above the bar; the destinations navigate.
- **AC-P7-3 Thread list.** Threads opens the thread list over the page, the full width less the card
  margins; choosing a thread opens it and closes the list. The list also closes on a second tap of Threads
  and on Escape.
- **AC-P7-4 Composer.** In a thread the composer is inside the screen and above the bar; the send button is
  at least 40 x 40 px on a touch screen; with the on-screen keyboard up (the viewport 420 px tall) the
  composer stays fully in view and keeps focus.
- **AC-P7-5 Approvals and questions.** A permission request and a question fit the screen above the bar,
  their buttons stay inside it and at least 36 px tall, and they can be answered by tapping.
- **AC-P7-6 Desktop unchanged.** At 600 px and wider (a desktop window, a phone turned sideways) the rail
  is the left column as before and there is no Threads button.
- **AC-P7-7 Safe areas and documentation.** The bar pads `env(safe-area-inset-bottom)`; the layout's top
  inset stays. `docs/design.md` gains the phone layout; the architecture's product entry points note it;
  the e2e specs join the matrix. No source comments; all text through i18n.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P7-1 to 4, 6 | `acceptance/p7/phone-layout.spec.ts` (copied to `tenon/packages/app/e2e/acceptance/`) | `verification/p7/phone-verification.spec.ts`: 360 x 740, Projects, Command Centre and Usage, one row of 44 px items, the safe-area rule, Settings from the bar, closing the sheet, a sideways phone |
| AC-P7-5 | `acceptance/p7/phone-docks.spec.ts` | the same docks seen in the screenshots |
| AC-P7-7 | diff review | screenshots under `evidence/p7-*.png` at 390 x 844 and 360 x 740 |

Commands, from `tenon/packages/app` with `PLAYWRIGHT_PORT=3105 PLAYWRIGHT_SERVER_PORT=4105`:
`bunx playwright test e2e/acceptance/phone-layout.spec.ts e2e/acceptance/phone-docks.spec.ts`; for the
verification set, copy it into `e2e/acceptance/`, run it and delete the copy. Then the whole e2e suite and
`bun run test:routes`.

## P8: Capacitor shell for Android and iOS

One agent (TOR-1, no subagents) wrote this section, both test sets and the code; the review panel is a
scored self-review in three lenses.

Before: the renderer runs only in Electron and in a browser served by the server; a phone can be paired
(P6a, P6b) but there is no app to pair.

After: `tenon/packages/mobile` wraps the same renderer in Capacitor 6 (Capacitor 7 needs JDK 21; this
computer has JDK 17). The app opens on a pairing screen (address and code typed in, a `tenon://pair?…`
link, or a QR code scanned with the camera where the web view offers `BarcodeDetector`), pairs with
`POST /remote/pair`, keeps the device token in the platform's secure storage (an Android Keystore key
sealing it in app preferences; the iOS Keychain), then starts the renderer against that computer with
every request to it carrying `Authorization: Bearer <token>`. It reconnects with the stored token on the
next start and can sign out (forget the token). The Android app is built and run on the `tenon_api35`
emulator against the desktop app on this computer; the iOS project is generated and documented, and
unverified (no Mac). Nothing is published to a store.

### Contract

`tenon/packages/mobile/src/companion.ts`:

```ts
normalizeServer(input: string): string | undefined          // origin; http:// and port 47100 when missing
readPairing(link: string): { url: string; code: string } | undefined
pairDevice(fetch, input: { url: string; code: string; name: string }): Promise<{ url; id; name; token }>
  // rejects with Error(bad_code | expired | locked | invalid_name | too_many_attempts | unreachable | refused)
bearerFetch(fetch, pairing: { url: string; token: string }): typeof fetch
companionSession(store: { get(key): Promise<string | null>; set(key, value): Promise<void>; remove(key): Promise<void> }):
  { load(): Promise<Pairing | undefined>; save(p: Pairing): Promise<void>; signOut(): Promise<void> }
```

### Acceptance criteria

- **AC-P8-1 Package.** `tenon/packages/mobile` (`@tenon/mobile`) builds the renderer with the app's Vite
  plugin into `dist/` and holds `capacitor.config.ts` (app ID `dev.tenon.companion`, `androidScheme:
  "http"`, `cleartext: true`, since the link is plain HTTP on a trusted network), the generated `android/`
  and `ios/` projects, a secure-store plugin for each (`SecureStorePlugin.java`, `SecureStorePlugin.swift`)
  and `README.md` with the build steps for both. It joins the workspace's typecheck, lint, format and test.
- **AC-P8-2 Pairing.** `normalizeServer` accepts an IP, a host name or a URL (adds `http://` and port 47100
  when missing, keeps `https://`, drops paths) and refuses anything else; `readPairing` reads the QR link;
  `pairDevice` posts `{ code, name }` (the code upper-cased with spaces and hyphens removed) to
  `/remote/pair` with no credential and returns the token; a refusal names its reason, a 429 is
  `too_many_attempts`, a network failure `unreachable`.
- **AC-P8-3 Device token on every request.** `bearerFetch` adds `Authorization: Bearer <token>` to every
  request whose origin is the paired computer's (replacing any other credential and dropping an
  `auth_token` query), and leaves requests to other origins alone. The shell installs it for the renderer.
- **AC-P8-4 Stored, restored, forgotten.** `companionSession` keeps one JSON entry; a new session on the
  same store loads it; a damaged or non-HTTP entry reads as not paired; sign-out removes it. On the phone the
  store is the secure-store plugin. Settings › Servers in the shell shows the paired computer and Sign
  out.
- **AC-P8-5 On the emulator.** The Android debug APK installs and starts on `tenon_api35`; with Phone
  access on in the desktop app on this computer, the app pairs (code typed in), lists the computer's
  threads, opens one, sends a prompt to an empty thread (answered or failing for want of a paid harness
  login; either is recorded), and answers a permission request when one can be raised without a paid
  harness; after a restart of the app it reconnects without pairing again; Sign out returns to the pairing
  screen. Screenshots in `evidence/p8-*.png`.
- **AC-P8-6 iOS written, not verified.** The iOS project is generated (`ios/App`), the Keychain plugin is
  written, `Info.plist` allows local networking (`NSAllowsLocalNetworking`) and explains local network and
  camera use; README says it was never built or run, and why.
- **AC-P8-7 Documentation.** Architecture (a Mobile companion section), threat model (the token on the phone,
  plain HTTP, what the shell sends), `uml.md`, a diagram, the matrix, `docs/release-operations.md` (no store
  publishing; how to build the APK). No source comments except the tool-read kind.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P8-2 to 4 | `acceptance/p8/companion.test.ts`, `session.test.ts` (copied to `tenon/packages/mobile/src/`) | `verification/p8/companion-verification.test.ts`: IPv6, scheme case, method and body kept, look-alike origins, no bearer on pairing, the native project's manifest, config and plugin registration |
| AC-P8-1, 6, 7 | diff review, `bun run check` | the same verification file (project files) |
| AC-P8-5 | the emulator run with screenshots | the same run read back |

What the user must supply for iOS: a Mac with Xcode, an Apple ID (a free one runs it on their own
device for a week), and a run of the README's steps; nothing else is needed for Android debug builds.

## P3c: close the matrix's gap rows

One agent (TOR-1, no subagents) on `claude/feature-gap-tests` from `b022d3a1`. The tests describe behaviour
that already exists, so they were written against the unchanged product, run there first (the baseline is
the same tree), then frozen (`frozen\p3c\`).

### Acceptance criteria

- **AC-P3c-1** Every `gap` row has an automated test at the lowest layer that proves it, or moves to
  `manual` with the reason no automated layer reaches it (an Electron window, a native platform API, two
  computers). No `gap` row remains.
- **AC-P3c-2** Tests added: `app/e2e/regression/feature-gaps.spec.ts` (F-113 Pin, Fork, Delete from the
  thread menu; F-114 dragging a row onto the composer; F-119 an unknown route; F-301 making an event in the
  calendar form; F-618 the Environment window) and
  `tenon/test/server/httpapi-second-brain-gaps.test.ts` (F-211 instructions read, write, remove, size limit;
  F-504 the Command Centre folder). F-403 and F-1010 cite tests that already exist.
- **AC-P3c-3** Rows F-1010, F-1210 and F-1212 say what P2 tested; F-708 no longer cites a spec that is gone;
  every row whose note said it failed on the 2026-11-26 baseline says it passes since P3a/P3b.
- **AC-P3c-4** The matrix acceptance test (`acceptance/p1-matrix.test.ts`) passes. Product bugs a new test
  exposes are fixed with the test, or recorded.

| Criterion | Acceptance set | Verification set |
| --- | --- | --- |
| AC-P3c-1 to 4 | the two new test files; `acceptance/p1-matrix.test.ts` | `verification/p1-matrix.test.ts` (P1's, kept outside the repository) run on the refreshed matrix; the new e2e spec run three times |

## Verification commands

Run from `tenon/packages/desktop` unless noted. Verification tests are copied to
`implementations/mobile-sync-programme/verification/` in the verifier's checkout only.

```sh
bun test ../../../implementations/mobile-sync-programme/acceptance/p1-matrix.test.ts
bun test ../../../implementations/mobile-sync-programme/acceptance/p2-device.test.ts
bun test src/main/device.test.ts
cd ../app && bun test ../../../implementations/mobile-sync-programme/acceptance/p2-device-boot.test.ts
```

```sh
bun test ../../../implementations/mobile-sync-programme/verification/p1-matrix.test.ts
bun test ../../../implementations/mobile-sync-programme/verification/p2-device.test.ts
cd ../app && bun test ../../../implementations/mobile-sync-programme/verification/p2-device-boot.test.ts
```

Standard checks for a phase that changes code, from the repository root: `bun run typecheck`,
`bun run lint`, `bun run format:check`, `bun run test:desktop`, `bun run test:app`.

Baseline on the base commit: recorded under Completion evidence.

## Completion evidence

Filled in as phases pass. Implementor reports and verifier results are kept apart. All subagents ran
on Opus 5.5 at medium effort.

### P1 and P2 (2026-11-26)

| Item | P1 feature test matrix | P2 Device tab |
| --- | --- | --- |
| Pull request | #368, branch `claude/feature-test-matrix` | #369, branch `claude/device-tab-fixes` |
| Verified commit | `3e4ac333` | `099c7618` |
| Correction rounds before the panel | 1 (F-1407 was `covered`; rows with failing evidence did not say so) | 3 (key errors and a lint warning; the phone layout the user asked for; the toolbar detached in landscape) |
| Verifier, independent of the implementor | acceptance 8, verification 12, 32 rows read against code, two specs re-run | acceptance 13 + 5, verification 14 + 3, `typecheck`, `lint`, `format:check`, `test:desktop` (262), `test:app` (1482 + 61), diff read against every criterion |
| Orchestrator's own checks | diff read; the baseline's numbers cross-checked | `bun run check` exit 0 on the tip; device functions and the Device tab driven against a live Android emulator (API 35), screenshots in `evidence/` |

Integration: both merge onto the base with no conflict (verifier's local merge `1b67879f`); every test and
check above passes on the merged tree. Local branch `claude/mobile-sync-integration` (`57ec14e9`) is the
plan plus both phases and is the base for P3.

Review panel (plan conformance, correctness and regressions, integrity and scope): round 1 on `79b3de3c`
scored 9.5, 10 and 9. Deductions: F-1307 cited a spec that does not drive Settings › Servers; nine
`Source` paths did not exist. The second reviewer's notes became AC-P2-12. Round 2 on `1b67879f`
scored 10, 10 and 10.

Diagrams: the proposed view's "Device tools: fixed keys, boot state" node is now built as drawn; the
phone layout and input validation were added during the phase and are described in AC-P2-10 to 12.

Left unverified: anything on iOS (no Mac; the `idb` argument lists, including Return as HID key 40, are
unit tested only); wide and short panel sizes were simulated by forcing the panel size; the boot line
after a three-minute timeout rests on a code read. Open notes, not fixed: a literal `%s` cannot be
typed on Android; very long text goes to `adb` as one argument; each frame is decoded twice.

The verification set gained one check the panel showed was missing (every `Source` file path exists).

### P4 thread sync engine (2026-11-26)

- Verified commit: `56dcc9be` (base `688ce713`), six commits. Implementor report and verifier results
  agree: acceptance 11, independent verification 16, the implementor's own 28; `typecheck`, `lint`,
  `format:check` pass; the core suite shows only the three Windows failures already on the base.
- Corrections before the panel: two defects in the plan author's own acceptance files (a cast and
  formatting); the verifier's probe found a pull that failed partway left part of the thread behind and
  reported `diverged` (now all or nothing, code `unsupported`).
- Review panel: round 1 on `e266061c` scored 10, 10, 10 against the plan, but the correctness
  reviewer's probes found a lost reply to a manifest write could leave the stored thread unreadable, a
  rolled-back manifest could flip the local owner, and three `gcsStore` weaknesses; these became
  AC-P4-11. Round 2 on `a29d856e` scored 10, 10, 9 (a stale Ownership sentence) and found the late-commit
  variant of the first bug, which tightened AC-P4-11's first bullet. Round 3 on `56dcc9be` scored 10,
  10, 10; the correctness reviewer could not make a stored thread unreadable or make `push` report
  something untrue.
- Plan changes made during the phase, each from evidence: codes `foreign_path` and `unsupported`, the
  two-second retry bound and fifteen-second request limit, the all-or-nothing pull, AC-P4-11.
- The verification set grew from 13 to 16 tests (lost reply, rolled-back store, late commit); the last
  was run against the previous commit first and failed there as intended.
- Diagram: the detail view's six steps are built as drawn, with one addition it does not show: the
  manifest is re-read after a failed write before anything is removed.

Left unverified: the real Google Cloud Storage API (only local stand-ins were used; the conflict
reasoning relies on its documented behaviour). Known limits recorded in the architecture section: files
an event only points to and child threads are not synced; a pull downloads the whole stored thread and
holds the database connection while it applies; a macOS path is accepted on Windows; one unreadable
manifest fails the whole `list`; orphan segments are never cleaned up except by `remove`; a store
writer without the key can delete objects or roll a thread back.

### P5a sync manager (2026-11-27)

One agent (TOR-1, no subagents, no reviewer panel) implemented P5a on base `2fc3daaf`, branch
`claude/thread-sync-manager`. The plan and both test sets were written earlier by the plan author.

- Acceptance `core/test/thread-sync/manager.test.ts` (copied unchanged): 4 pass, first run after the
  code existed (before it, `ThreadSync.manager` did not exist). Verification set, run from an untracked
  copy and deleted: 6 pass, first run.
- The implementor's own tests: `manager-edges.test.ts` (settings set aside, field limits, `lastError`,
  `win32` and `darwin` folder forms, owned continue, bridge calls and that they are not agent tools),
  `service.test.ts` (a `session.idle` event pushes the thread), `protocol/test/thread-sync.test.ts`
  (every code's status), `tenon/test/server/httpapi-thread-sync.test.ts` (routes through the app
  server: 200, 400, 412 with the code in the body).
- `bun run check` from the root: exit 0. `core` tests: 1565 pass, 4 fail (the three baseline Windows
  failures and `RepositoryCache` timing out at 5 s, which passes 6 of 6 alone). `tenon` tests: 2973
  pass, 4 fail (baseline F-1604 and three `tool.shell abort` timing tests that also fail alone; that
  file imports nothing this phase changed; not checked on the base).
- Scope notes, each needed by a criterion: the engine gained `compare` (read only) for AC-P5a-3; the
  app server (`tenon/src/server/routes/instance/httpapi/server.ts`) and `server/src/routes.ts` each add
  `ThreadSync.node` so the routes and the idle hook exist in the running server (AC-P5a-6);
  `client/src/contract.ts` and `client/test/promise.test.ts` name the new `threadSync` group. The manager
  takes an optional `platform` so tests check both path forms. Bridge contract chosen here for P5b:
  `sync_key` answers `{ key: base64url }`, `sync_token` answers `{ token }`.
- Left for later: the desktop half of both bridge calls (P5b); a Windows thread cannot be continued on
  macOS (deferred work); `threads()` downloads every stored thread; only `session.idle` (published by
  the `tenon` session status) triggers a push.

### P4b Google Drive store (2026-11-27)

One agent (TOR-1, no subagents) wrote the plan, both test sets and the code on base `ed33593a`, branch
`claude/thread-sync-drive-store`. The verification set was frozen with the plan in a folder outside the
repository and is not committed; it is the same author's second design, not an independent check. The
review panel was replaced by a scored self-review in three lenses.

- Baseline, before any product edit: the new acceptance and verification cases all failed for the
  intended reasons (`ThreadSync.driveStore is not a function`, a status that still had `bucket`); the
  P4 engine cases on the folder store passed (10 pass, 44 fail).
- After: `bun test test/thread-sync` in `tenon/packages/core` with the verification copies in place:
  96 pass, 0 fail across 8 files (P4b acceptance 23, verification 13, P5a acceptance 4, the P4
  acceptance and the engine and store suites with both stores); P4b acceptance, P4 acceptance and P5a
  acceptance together 41 pass, and the verification file 13 pass, on their first run after the code. Protocol tests 5 pass; route test 1 pass.
- `bun run check`: typecheck, lint (warnings only, as on the base), format and `check:generated` pass;
  its `bun run test` step hung once in `@tenon/desktop` (no output for 25 minutes) and was stopped. The
  desktop suite alone: 262 pass, 6 skip, 0 fail in 18 s. Then `bun run test` and `bun run build` from
  the root: both exit 0. The regeneration rewrote six client files with line endings only; they were
  restored with `git checkout -- tenon/packages/client`.
- `bun run test:engine`: core 1610 pass, 15 skip, 4 fail: the three Windows baseline failures (F-1201,
  F-909, F-211) and `Npm.add` › reifies when package cache directory exists, which timed out at 9 s
  under load and passes alone (5 of 5); `npm.test.ts` touches nothing in this change. The `&&` stops the script there, so `tenon/packages/tenon` was run
  on its own: 2973 pass, 57 skip, 4 fail: `session HttpApi` › returns v2 public unavailable errors
  (F-1604, on the baseline) and the three `tool.shell abort` timing tests known to fail on this
  computer.
- Tests changed after the freeze, each without changing an assertion: Prettier reformatted the copied
  acceptance and verification files (checked equal with white space, commas and parentheses removed)
  and the copies in this folder were updated to match; `acceptance/p4/acceptance.test.ts` types its
  store list as `Array<"folder" | "drive">` because `describe.each` refuses a readonly tuple
  (typecheck). The P5a assertion changes are listed above, under P4b.
- Removed: `core/src/thread-sync/gcs.ts`, `core/test/thread-sync/gcs-fake.ts`,
  `acceptance/p4/gcs-fake.ts`, the Cloud Storage cases of `store.test.ts`; `engine.test.ts` stores
  nothing readable in Drive instead, and its flaky-store cases run on both stores.
- Self-review, round 1 on `70622485`: plan conformance 9 (no completion evidence or record of test
  changes after the freeze yet), correctness and regressions 10, integrity and scope 9.5 (same record
  missing). Fixed by this section; round 2: 10, 10, 10.
- Left unverified: the live Drive API (no credentials exist; two local fakes only); that a second
  computer signed in through the same OAuth client sees the files under `drive.file` (the documentation
  implies it, does not say it); how fresh Drive listings are, on which the emulated conditional write
  depends. `status()` now asks the credentials for a store on every call, also while sync is off, where
  P5a asked only once a bucket was set.
### P0 first-wave e2e time-outs (2026-11-27)

One agent (TOR-1, no subagents) on branch `claude/e2e-first-wave-timeouts` from `9538b1f6`. The plan section
was written after the five base runs, because the investigation had to start by measuring; it was frozen
before any spec changed.

- Base, five default-worker runs: 1 clean of 5; none of the seven first-wave tests failed. Failures:
  `thread-menu-rename` (3 runs), `terminal-composer-focus`, `session-timeline-transport` heartbeat,
  `review-line-comment` hover (1 each). Record: `docs/records/e2e-first-wave-2026-11-27.md`.
- Cause of the reported time-outs (AC-P0-2): Vite re-optimizing the Markdown worker's dependencies on a
  cold cache and reloading every open page. Already fixed by P3b's `optimizeDeps.include`; the
  experiment with the cache deleted gave 5 failures of 92 acceptance tests without it and 0 with it.
- Fixed (AC-P0-3), both in the tests' own synchronisation, each with a stress run before and after:
  `thread-menu-rename` polls the recorded `PATCH` (9 of 40 failed before, 0 of 40 after);
  `session-timeline-transport` heartbeat waits for the rendered paragraph before its snapshot (2 of 40, then
  0 of 40). No time-out, retry, skip or sleep was added.
- After, five default-worker runs (AC-P0-4): 4 clean of 5. Run 4 failed `home-page-stable` (eightfold CPU
  throttling, composer not visible within 10 s under ten workers). **AC-P0-4 is not met**; the record says
  why the remaining load-sensitive and unexplained tests were left.
- Self-review, round 1: plan conformance 9 (plan written after measuring; said here), correctness and
  regressions 10 (both changes keep their assertions; stress before and after), integrity and scope 9
  (AC-P0-4 missed, must be said in the report, not hidden). Round 2 after this section: 10, 10, 10 for what
  was done; AC-P0-4 stays open.
- `bun run check` on `b19e2295`, in a separate worktree: exit 0 (typecheck, lint with warnings only as on the
  base, format, generated client, tests, build).

### P5b thread sync in the desktop app (2026-11-27)

One agent (TOR-1, no subagents) on `claude/thread-sync-desktop` from `b19e2295`. The P5b section,
`acceptance/p5b/` and the verification set (kept in
`C:\Users\sense\.tor-verification\tenon-mobile-sync\frozen\p5b\`) were written first and frozen. A first
draft of the desktop code was written while the P0 runs were still going; the baseline was then taken
with that draft moved out of the tree, so the recorded failures are the real baseline.

- Baseline: every new file failed at its import (`./oauth`, `./thread-sync-model`), 0 pass.
- After: desktop `bun test src/main/thread-sync` 25 pass with the acceptance file, `endpoints.test.ts`
  and the verification copy (11 acceptance, 11 verification, 3 endpoint); the app model test 4 pass;
  the core end-to-end verification (`core-e2e-verification.test.ts`: the desktop service signs in to the
  fake Google, makes a key, answers a loopback bridge; `bridgeCredentials` with the Drive fake; a real
  `ThreadSync.manager` reports ready and pushes) 1 pass. Both verification copies were deleted from the
  tree afterwards.
- Package suites: desktop 287 pass, 6 skip, 0 fail; app unit 1507 pass, browser 61 pass; core
  `test/thread-sync` 84 pass. Typecheck of app, desktop and core clean.
- The real desktop app (`TENON_TEST_ONBOARDING=1 bun run dev:desktop` with
  `TENON_THREAD_SYNC_OAUTH_ENDPOINT` and `TENON_THREAD_SYNC_DRIVE_ENDPOINT` on two local fakes), driven over
  CDP: saved a client, signed in (the system browser opened the fake's authorize page and the loopback
  callback finished it), made a key (phrase shown once), turned sync on ("Sync is on."), then a second
  "computer" (a core script with the same phrase) pushed a thread, which listed as "Laptop · Not on this
  computer"; continuing it through `POST /api/thread-sync/threads/:id/continue` made it "This computer · Up
  to date". Screenshots `evidence/p5b-*.png`. The first two show a layout fault they exposed (the client
  fields overflowed the row and scrolled the list sideways), fixed before `p5b-4` and `p5b-5`. The
  native folder picker of "Continue here" was not driven; the phrase in `p5b-2` is a throwaway key for the
  fake Drive.
- Tests changed after the freeze: none in their assertions. Prettier reformatted
  `acceptance.test.ts` and `sync-model.test.ts` (same text without white space); the copies here were
  updated to match.
- Scope notes: `core/src/thread-sync/bridge.ts` gained the loopback-only Drive endpoint override (needed
  for AC-P5b-7 and the live check), which also needs `bun run test:engine`. The Sync tab uses the existing
  `cloud-upload` glyph, recorded in `docs/design.md`.
- Base failure seen: `acceptance/p1-matrix.test.ts` AC-P1-2 fails on main because F-708 cites
  `e2e/regression/session-timeline-locale-projection.spec.ts`, which no longer exists (P3c refreshes the
  matrix).
- Self-review, round 1: plan conformance 9 (the contract said the client secret was optional and the status
  had a `clientSecret` flag; the plan was corrected before freezing, but AC-P5b-5's "web build" line and
  the deferred sharing note were missing from the docs), correctness and regressions 9 (the page's input
  rows overflowed and scrolled the list sideways, seen in the live screenshots), integrity and scope 10.
  Fixed: narrower fields and a stacked client row, the deferred-work entry; round 2: 10, 10, 10.

Left unverified, and what the user must supply: see the P5b section above (a Google Cloud OAuth client of
type Desktop app; `docs/records/thread-sync-manual-test.md`). Nothing ran on macOS.

`bun run check` on `3a965e13` (separate worktree): exit 0.

### P6b remote access in the desktop app (2026-11-27)

One agent (TOR-1, no subagents) on `claude/remote-access-desktop` from `3a965e13`. Plan section and both
sets written and frozen (`frozen\p6b\`) before any product code.

- Baseline on `3a965e13`: the three desktop files and the app model test fail at their imports, 0 pass.
- After: desktop `bun test src/main/remote-access` (acceptance and controller) 11 pass; the verification
  copy 7 of 8 under Bun; `listener.node-test.ts` 2 pass under Node; app `remote-access-model.test.ts` 2 pass
  and `remote-access-qr.test.ts` 1 pass. Package suites: desktop 287 pass, 6 skip, 0 fail plus the Node
  tests (7 pass); app unit 1510 pass, browser 61 pass. Typecheck of app and desktop clean.
- Tests changed after the freeze, with the reason: Bun's `node:http` neither raises `upgrade` nor keeps a
  `..` segment in a client request path (it answered an empty close and sent `/api//config`), while Node,
  which Electron main runs on, answers 403 and forwards `/api//session/../config` as received (probe run
  under both). The acceptance case "socket upgrades are refused" moved unchanged in its assertions from
  `acceptance.test.ts` to `listener.node-test.ts`, run by the desktop `test` script under Node; the
  verification case on the raw path fails under Bun for the same reason and its Node twin in
  `listener.node-test.ts` passes. AC-P6b-3 is about the shipped runtime, so the contract did not change.
- The real desktop app (`TENON_TEST_ONBOARDING=1 bun run dev:desktop`), driven over CDP: Phone access was
  off; turned on, it listened at `http://192.168.10.136:47100` (the Wi-Fi address); Pair a phone showed the
  QR code and `G8E3-6SX8`; a script standing in for the phone paired over the LAN address (200, a token),
  then `GET /api/health` and `/api/session` answered 200, `/api/pty` 403 (companion scope), no credential
  and the password 401, and a Capacitor preflight 204 with its origin. The device listed as "Seen just
  now"; a used code was refused (`bad_code`); a second pairing's token answered 200, then 401 after Revoke
  in the page; turned off, the port refused connections. Screenshots `evidence/p6b-*.png`; the first shows
  two layout faults it found (the section touching the server card, the address select empty), fixed
  before the others. Windows Defender Firewall was not touched: requests came from this computer.
- Scope notes: a new dependency, `qrcode-generator@1.4.4` (MIT, no dependencies) in `@tenon/app`, draws the
  QR code; `thread-sync-client.ts` now exports its request helper (`ownerRequest`) for the remote routes.
- Base failure seen: the same F-708 matrix row as in P5b.
- Self-review, round 1: plan conformance 9 (the plan said the listener "answers 403" to upgrades without
  naming the runtime; recorded above), correctness and regressions 9 (two layout faults seen live; Bun
  versus Node difference found by the frozen tests), integrity and scope 9.5 (the new dependency needs
  stating in the report). After the fixes and this record: 10, 10, 10.

Left unverified: a real phone (P8), a second machine on the LAN, the firewall prompts on Windows and macOS,
macOS as a whole, IPv6 addresses in practice.

`bun run check` on `3a965e13`: exit 0; `bun run test:engine` there: `tenon` 2994 pass, 3 fail (the known
`tool.shell abort` timing tests), `core` 1622 pass, 1 fail: `device file > is private to the user`, which
passes (23 of 23 in `test/remote-access`) in this worktree and failed only in the check worktree, which
lives under `%TEMP%`, where the inherited access list differs. Not a change of P5b (no core file but
`bridge.ts` changed).

### P7 phone layout (2026-11-27)

One agent (TOR-1, no subagents) on `claude/phone-layout` from `00c948f4`. Plan section and both sets written
and frozen (`frozen\p7\`) before any product change; screenshots of the base at 390 x 844 taken first
(`evidence/p7-before-390-*.png`).

- Baseline on `00c948f4`: 8 failed, 3 passed of the 11 tests (AC-P7-1 and the two desktop-width checks
  passed on the base: the Home heading was cut by its own box, which AC-P7-1's measure does not catch; the
  screenshots show it).
- After: acceptance `phone-layout.spec.ts` and `phone-docks.spec.ts` 8 pass, verification 4 pass (one
  combined run 11 of 11; `--repeat-each=5` 35 of 35). In one run of all four files the permission dock
  was not found within 10 s once; it did not recur in 35 repeats.
- Full `bun run test:e2e` (default workers): 224 passed, 1 skipped, 1 failed:
  `terminal-composer-focus` (the unexplained flake from P0), then 40 of 40 with `--repeat-each=10`.
  `bun run test:routes`: 11 passed. App unit 1510 pass, browser 61 pass; session-ui 196 pass; app and e2e
  typecheck clean.
- Tests changed after the freeze, with the reason: AC-P7-3 now opens the "General" group before choosing the
  thread. The fixture's thread sits in the workspace group, which starts folded at every width; the
  criterion is that choosing a thread opens it and closes the list, not that groups open by themselves.
  Prettier wrapped one line of `phone-layout.spec.ts`; the copy here matches.
- Found and fixed while checking the screenshots: the window's sidebar toggle did nothing on a phone (now
  hidden below 600 px); the calendar's date title was cut to "Fri…" (now on its own line below 600 px).
- Note: `bun run test:routes` was run without `PLAYWRIGHT_PORT=3105`/`PLAYWRIGHT_SERVER_PORT=4105` (it used
  the defaults); nothing else was running.
- Self-review, round 1: plan conformance 9 (AC-P7-1's measure would not have caught the cut heading; said
  above, and the screenshots are the check), correctness and regressions 9.5 (the dock-not-found once),
  integrity and scope 9 (the routes run ports). After recording them: 10, 10, 10 for what was built.

Left unverified: a real phone and its keyboard (the keyboard was simulated by shrinking the viewport); iOS
safe areas on a notched device; the note editor on a phone (Projects list was checked, not an open page).

`bun run check` on `00c948f4` (P6b) and `c0391286` (P7), in the check worktree: exit 0 both.

### P8 Capacitor shell (2026-11-27)

One agent (TOR-1, no subagents) on `claude/mobile-shell` from `c0391286`. Plan section and both sets written and
frozen (`frozen\p8\`) before the package existed.

- Baseline on `c0391286`: the package did not exist; with `companion.ts` moved aside all three acceptance and
  verification files failed at the import, 0 pass.
- After: `bun test src` in `tenon/packages/mobile` 13 pass with the verification copy (acceptance 6, the
  implementor's `workspaces.test.ts` 1, verification 6 including the native project checks), copy deleted;
  desktop `src/main/remote-access` 12 pass; typecheck of mobile, app and desktop clean; Prettier clean on the
  package.
- The emulator run (AC-P8-5), `tenon_api35` (Android 15, web view Chromium 124) against
  `TENON_TEST_ONBOARDING=1 bun run dev:desktop` with Phone access on `http://192.168.10.136:47100`, driven
  through the web view's DevTools socket and `adb`: the debug APK installed; pairing with a typed address and
  code worked; the thread created on the computer was listed under the computer's folder and opened; a prompt
  typed in the composer could not be sent because the isolated desktop profile has no model (the composer
  shows "Select model"), and the same prompt sent from the phone through `POST /api/session/:id/prompt` with
  the device token was admitted (200, `admittedSeq` 1); no permission request could be raised without a
  model, so answering one on the phone was not run; after a force-stop the app reconnected with the stored
  token; Sign out in Settings › Servers › This phone returned to the pairing screen. Screenshots
  `evidence/p8-*.png`.
- Faults the run found and fixed: the listener passed the phone's `Origin` to the server, which refused it
  (`listener.ts` now drops it for the phone origins; `listener-origin.test.ts`); `URL.parse` is missing in
  Chromium 124 (phone-facing code now uses `new URL` in a guard); a fresh phone had no workspace, and `/path`
  and `/project` are outside the companion scope (the shell seeds the workspace list from the folders of
  `GET /api/session`); a reload on a deep route loaded no assets with `base: "./"` (now `/`, and pairing and
  sign-out go to `/`). The last APK installed predates one type-only change (`preconnect` copied onto the
  wrapped `fetch`).
- Tests changed after the freeze, with the reason: the verification file built a look-alike URL as
  `http://127.0.0.1:<port>.evil.example`, which is not a URL at all; the copy that ran uses
  `http://127.0.0.1.evil.example:<port>`. `bearerFetch` now leaves `/remote/pair` without a token, which the
  verification set asked for and the contract did not say; the contract above is read that way.
- Scope notes: the Capacitor 6 CLI fails under the workspace's `tar` 7 override, so `scripts/cap.cjs` runs it
  with a shim instead of changing the override; Android compiles against SDK 35 (installed) with
  `android.suppressUnsupportedCompileSdk=35` for AGP 8.2.1, and `minSdkVersion` 23 for the Keystore API;
  `packages/mobile/android` and `ios` are excluded from Prettier and oxlint; the root `AGENTS.md` names the
  package.
- Self-review, round 1: plan conformance 8.5 (AC-P8-5's prompt from the composer and the approval were not
  run; QR scanning not run), correctness and regressions 9 (four faults found live, all fixed and tested), integrity and scope 9
  (the listener fix belongs to P6b's code; recorded here). After the record: plan conformance stays 9 for the
  two runs that need a model, correctness 10, integrity 10.

What the user must supply: for iOS, a Mac with Xcode and an Apple ID; for the prompt and approval on the
phone, a model the desktop can use (any harness login or provider key).

`bun run check` on `b022d3a1` (P8), in the check worktree: exit 0.

### P3c gap rows (2026-11-27)

One agent (TOR-1, no subagents) on `claude/feature-gap-tests` from `b022d3a1`.

- 22 `gap` rows before, 0 after. Tested: F-113, F-114, F-119, F-301, F-618 (e2e,
  `feature-gaps.spec.ts`, 7 tests), F-211 and F-504 (route tests, 3 tests); F-403 and F-1010 now cite
  tests that already existed (`runDue`; P2's device tests). Moved to `manual` with the reason in each note
  (an Electron window or native API, or two computers): F-1009, F-1011, F-1203, F-1303, F-1304, F-1305,
  F-1402, F-1407, F-1409, F-1411, F-1414, F-1421, F-1503. Refreshed: F-1010, F-1210, F-1212, F-708 (its
  missing spec dropped), F-102 (cites `home-page-stable.spec.ts`, which P3b added) and the 42 rows whose
  notes said they failed on the baseline.
- The tests describe existing behaviour; their first run was on the unchanged product: the e2e spec 7 of 7
  after two expectations of mine were corrected before the freeze (the Environment window lists "Folder",
  not the folder's name; Escape closes it when focus is inside it, which the design guide implies), then
  21 of 21 with `--repeat-each=3`; the route tests 3 of 3. No product bug was found.
- The matrix sets: `acceptance/p1-matrix.test.ts` 8 pass and P1's verification set (outside the repository)
  12 pass, 20 of 20; before the refresh both failed on F-708's missing spec and the verification set also on
  the uncited `home-page-stable.spec.ts`.
- Tests changed after the freeze: Prettier reformatted both new files.
- Self-review, round 1: plan conformance 9 (13 of 22 rows were reclassified rather than tested; each says why,
  and P3d drives them), correctness 10, integrity and scope 10. Round 2 after this record: 10, 10, 10, with
  the reclassification stated as the main limit of the phase.
