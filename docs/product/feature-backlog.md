# Feature backlog (2026-11-27)

Ranked additions after the mobile and sync programme
([plan](../../implementations/mobile-sync-programme/implementation.md), phase P9). Value is what the user
gains, cost the work (S under a day, M a few days, L a week or more), risk what can go wrong. "Needs you"
names a decision or outside account only the user can supply; items without one can be built straight away.

| Rank | Addition | Value | Cost | Risk | Needs you |
| --- | --- | --- | --- | --- | --- |
| 1 | **Phone: a notification when a thread needs you** (a permission request, a question, a finished turn), while the app runs in the background, through Capacitor local notifications fed by the event stream | High: the phone's main job is answering the computer when it asks | M | Android stops background web views; notifications only arrive while the app process lives. True push needs a server | For push when the app is closed: a Firebase project (FCM) and an Apple push key, and a relay, since the computer is not reachable from the internet |
| 2 | **Phone: share to the vault Inbox** (Android share sheet and iOS share extension post text, links and images as an Inbox page) | High: capture on the go is the phone's second job | M | The share target needs an Android intent filter and an iOS extension (unverifiable here); images need an upload route inside the companion scope | Which vault page is the Inbox when there are several workspaces |
| 3 | **Approvals in one place on the phone**: a "Needs you" list across every thread (the Command Centre's rows, phone-sized) | High | S | Low; the routes are already allowed for devices | None |
| 4 | **Cross-thread search** over titles and message text, from the command palette and the phone | Medium-high | M | Search over every thread's messages needs an index (SQLite FTS) and must respect archived threads | None |
| 5 | **Usage budgets**: a monthly limit per harness or Project with a warning and an optional stop | Medium | M | Wrong numbers stop work; harnesses report usage differently | The limits, and whether a budget may stop a running agent |
| 6 | **Page rename and move between Projects** in the vault | Medium | M | Links to the page must follow it; the agent may be writing the page | None |
| 7 | **Undo for agent edits across a whole turn** (today Undo works per write card and per tracked edit) | Medium | M | Later edits by the user must not be lost | None |
| 8 | **Thread sync: say the Drive folder never needs sharing**, and offer Revoke-on-the-computer when the phone signs out | Low-medium (prevents a mistake) | S | None | None |
| 9 | **Thread sync for child threads and attachments** (now only the parent thread's events move) | Medium | L | Blob storage size in Drive; more Drive calls | None |
| 10 | **A relay so the phone works away from home** (instead of a VPN) | High, later | L | A server on the internet that carries thread content; a security design | A host and who pays for it; whether to use an existing VPN (Tailscale) instead |
| 11 | **iOS build and TestFlight** | Medium | M | Unknown until built on a Mac | A Mac, an Apple Developer account (99 USD a year for TestFlight) |
| 12 | **Continue a Windows thread on macOS** (map the stored folder before replay; `docs/deferred-work.md`) | Low-medium | M | Paths inside events stay Windows paths | None |

Found while building the programme (sources: `docs/deferred-work.md`, the P3d record, the self-reviews):
the Environment window closes on Escape only when focus is inside it; `checkAppExists` is always true on
Windows; the effective zoom range is Chromium's 0.25 to 5; a phone that signs out still has a valid token
until revoked on the computer.

## Built in P9

Items needing no decision were built from the top until the next one needed a choice or an account:

- **3. Approvals in one place on the phone** was checked first: the Command Centre hub already lists "Needs
  you" rows across Projects and answers permissions in place, and the phone reaches it through the bottom
  bar, so nothing new was built; it is marked done here.
- **8. Sync and sign-out notes**: Settings › Sync says the Drive folder never needs sharing; Settings ›
  Servers › This phone says to revoke the phone on the computer as well.

Items 1 and 2 are the next most valuable and can be started without an account for their local halves
(notifications while the app runs; the Android share target), but each adds a native plugin and needs a
decision on scope (which events notify; which Inbox), so they wait for the user.

Not built although they need no decision: items 4 (cross-thread search), 6 (page rename and move) and 7
(turn-wide Undo). They were left because this run ran out of room, not because they need a choice; they are
the next to build.

## Built after the 28 Nov review

From the [feature review](../../implementations/missing-features/implementation.md) (usage budgets, #5, left
out on request):

- **1. Phone notifications** (local half): a local notification when a thread needs you while the companion
  runs in the background (`@capacitor/local-notifications`). Push with the app closed still needs FCM/APNs and a
  relay.
- **4. Cross-thread search**: Search everywhere in the command palette (Ctrl/Cmd+Shift+F) over pages, tasks,
  events and thread messages.
- **6. Page rename and move between Projects**, with links in other pages following the page.
- **7. Undo a whole agent turn**: Undo turn on a finished turn's last row.
- Also new: Ctrl/Cmd+F find in threads, pages, notes, Settings, the side panel and terminals; backlinks; page
  templates and Daily notes; Project starter templates; Inbox triage; event and task reminders; commit, push and
  open a pull request from the review panel; Settings › Backup; the weekly review page.

