# Manual feature checks (2026-11-27)

Programme phase P3d ([plan](../../implementations/mobile-sync-programme/implementation.md#p3d-manual-feature-checks)).
The desktop app ran from source (`TENON_TEST_ONBOARDING=1 bun run dev:desktop`: an isolated profile, an
in-memory database) on Windows 11 and was driven over the DevTools protocol, calling the renderer's
`window.api` (the same IPC the pages use) and opening Settings tabs. Screenshots are in
`implementations/mobile-sync-programme/evidence/p3d-*.png`; earlier runs are cited where a phase already
drove the feature. macOS was not run.

| Row | What was done | Result |
| --- | --- | --- |
| F-1303 Calendar settings | Opened Settings › Calendar | The panel shows Google accounts (none), Sync now (disabled without an account), last sync, automatic sync, interval and the two triggers. Syncing with a real account stays F-304 (blocked) |
| F-1304 Dictation settings | Opened Settings › Dictation | Language, the model list with sizes and Download. Switching and removing a model were not run: no model is downloaded in the isolated profile (a 270 MB to 886 MB download) |
| F-1305 Command Centre settings | Opened Settings › Command Centre | Default harness, default agent and the thread retention field. Choosing a harness was not run (no harness is signed in) |
| F-1402 Onboarding | `isFirstLaunchOnboardingPending()`, `isOldLayoutEligible()` | Pending `true` in the fresh profile and `false` after it finished (the app created "Default Project"); old layout not offered (`false`) |
| F-1407 Open in another app | `checkAppExists` and `resolveAppPath` for six names | On Windows `checkAppExists` answers `true` for every name by design, including a made-up one; `resolveAppPath("powershell")` finds `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, while "vscode", "Visual Studio Code", "Windows Terminal" and "File Explorer" resolve to `null` (not on `PATH` under those names). macOS lookup not run |
| F-1409 Window state | `getWindowID`, `getWindowFocused`, `getWindowFullscreen` | A stable window ID, focused `true` while driven, fullscreen `false` |
| F-1411 Zoom and pinch zoom | `setZoomFactor` with 25, 0.01, `NaN`, then 1; pinch toggled | The handler clamps to 0.2 to 10, but Chromium's own limits apply first: 25 gives 5, 0.01 gives 0.25; `NaN` is refused; 1 restores. Pinch zoom toggles. **Bug found and fixed:** `set-pinch-zoom-enabled` passed any value to the store, and a missing value crashed it ("Use delete() to clear values"); it now stores `enabled === true` |
| F-1414 Telemetry | `recordStartupMilestone`, `exportDebugLogs` | Both answer; the export wrote a zip of the logs to Downloads (deleted after the check) |
| F-1421 Desktop widget | `widget.toggle()`, then `hide()` | A second window (`?surface=widget`) opened with Note, Status and Command and "Nothing running"; hide closed it |
| F-1503 Harness sync | Opened Settings › Instructions | The page read this computer's existing harness sync file and showed its state. Joining from a second computer and taking over were not run (one computer) |
| F-1211 Device tab with an emulator | Run in P2 (`evidence/p2-*.png`) | Boot, frames, tap, keys and text on `tenon_api35` |
| F-1009, F-1011 Agent browser tools, `render_svg` | Not run | They are called by agents over the loopback bridge with the server's bridge token, which only the server holds; no agent with a model was available |
| F-1105 Real shells | Not run | Time; the unit tests cover detection |
| F-1203 File viewers (PDF, video, Word) | Not run | Time |
| F-1209 Browser tab picker | Not run | Time |
| F-1408 Folder picker | Not run | A native dialog; the CDP driver cannot reach it |
| F-1412, F-1422 Window chrome, tray and icons | Not run | Need a packaged, installed build |
| F-627 Dictation end to end | Not run | Needs a microphone, a downloaded model and a build with the dictation engine |

Paid harness logins were not needed for any row run here; F-1305's harness choice and an agent calling the
browser tools need one (or any provider key) and stay open.
