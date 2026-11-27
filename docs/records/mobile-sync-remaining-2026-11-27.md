# Mobile and sync programme: what remains (2026-11-27)

Every phase of the [mobile and sync programme](../../implementations/mobile-sync-programme/implementation.md)
is merged into `main` (PRs #367–#384), and `bun run check` exits 0 on `main` at
`9c75230e`. This note lists what was not done or not proven, and what each item needs.

## Needs you

| Item | What it needs | Then |
| --- | --- | --- |
| Live Google Drive sync | A Google Cloud project with the Drive API on and a "Desktop app" OAuth client, entered in Settings › Sync | Follow [the manual sync test](thread-sync-manual-test.md) on two computers |
| iOS phone app | A Mac with Xcode and an Apple ID | Build steps in `tenon/packages/mobile/README.md`; the project has never been built |
| Phone prompts and approvals | A harness sign-in or provider key on the desktop, so a thread can run | Send a prompt from the phone composer and answer an approval; also unblocks manual rows F-1009 and F-1011 |
| Phone notifications (backlog item 1) | Your choice of approach | See [the feature backlog](../product/feature-backlog.md) |
| Share to Inbox (backlog item 2) | Your choice of approach | See [the feature backlog](../product/feature-backlog.md) |
| Remote access beyond the LAN | Your choice: VPN (works today) or a relay | Phone access is plain HTTP, for trusted networks only |
| Usage budgets | Your limits, if you want any | Not built |

## Not proven

- Drive listing freshness when two computers write at the same moment.
- Whether a second computer sees the first computer's files under the `drive.file` scope.
- QR scanning on the phone (pairing was tested by typing the code).
- The installed test APK predates one type-only change.
- Ten-worker browser test runs: 4 of 5 were clean. `home-page-stable` is load-sensitive;
  `review-line-comment` and `terminal-composer-focus` each failed once without a known cause.
- The full browser test suite and `bun run test:engine` were not rerun on the final `main`.
- The last eight PRs and five of the first nine were reviewed only by the agent that wrote them.

## Not run

- Manual rows F-1105, F-1203, F-1209, F-1408 (native dialog), F-1412 and F-1422 (need an
  installed build), F-627 (microphone and model). See
  [the manual checks](manual-feature-checks-2026-11-27.md).
- 13 matrix rows were moved from `gap` to `manual` because they need the Electron window
  or native APIs. See [the feature test matrix](feature-test-matrix.md).

## Not built (no decision needed)

- Cross-thread search.
- Page rename and move.
- Turn-wide Undo.

## Known failures

- `tenon/test/tool/shell.test.ts` ("tool.shell abort", 2 tests) fails on this machine;
  recorded in [deferred work](../deferred-work.md).
- Zoom is limited to 0.25–5 by Chromium, not the code's 0.2–10.
- On Windows the "does this app exist" check always answers yes.
