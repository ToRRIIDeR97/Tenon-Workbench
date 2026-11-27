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
