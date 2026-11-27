# Browser tab shows a white screen

Branch `claude/tor-1-agent-white-screen-7faf10`, base `63b8ecdd`. One agent (TOR-1) wrote the plan, both test
sets and the code; the tests are not independent of the author.

## Problem

Open a thread, open the Browser tab, load any address. The address bar, title and Back/Forward update, but
the page area stays white.

Expected: the page shows. It hides only while a dialog is open, while annotating, and before a page has
committed.

## Feature map

| Step | Component | What it does | Source |
|---|---|---|---|
| 1 | `SessionBrowserTab.place` | Sends the stage rectangle to main, or `undefined` (hide) when `annotate.active`, `covered()`, the stage is not `page`, or the stage is under 2 px | `tenon/packages/app/src/pages/session/browser-tab.tsx` |
| 2 | `covered` | Set by a `MutationObserver` on `document.body` (child list only) to `!!document.querySelector('[role="dialog"], [data-component="dialog-stack"] [data-expanded]')` | same file |
| 3 | `CommandStrip` | Mounted on every route except `/command`. Its card wrapper is always in the DOM, closed with `inert` and `invisible`; inside it is a `role="dialog"` element | `tenon/packages/app/src/features/command-centre/command-strip.tsx`, `tenon/packages/app/src/pages/layout-new.tsx` |
| 4 | `showBrowser` | With no bounds, sets the `WebContentsView` to 0×0 and invisible | `tenon/packages/desktop/src/main/browser.ts` |
| 5 | Stage element | `bg-[#fff]`; with stage `page` there is no overlay, so a hidden view leaves plain white | `browser-tab.tsx` |

Observed facts:

- The card's `role="dialog"` arrived in `c12b14b2` (12 Nov 2026); the strip moved into the thread view in
  `d9143619` (19 Nov 2026). The cover selector predates both.
- Running the current selector on the closed card's markup returns `true` (happy-dom, baseline run below).
- Loading, navigation state, failures and the consent path in main are unchanged and send `browser-state`
  normally, which matches the address bar updating while the page stays white.

Cause: the closed Command Centre card always matches the cover selector, so after the first DOM mutation
`covered()` is `true` for good and `place()` always hides the native view.

Second defect on the same path: the observer watches the child list only. The card opens by dropping `inert`,
which is an attribute change, so even with the selector fixed the tab would not hear the card open or close.

Not confirmed at runtime: the desktop app was not launched for a baseline screenshot. See Verification.

Other `role="dialog"` elements (`hub-view.tsx` sheet, `selection-reply.tsx`, `markdown-file-reference-peek.tsx`)
mount only while shown; they keep hiding the page, which is intended.

## Scope

- New `tenon/packages/app/src/pages/session/browser-cover.ts`: the cover rule and its watcher.
- `tenon/packages/app/src/pages/session/browser-tab.tsx`: use them.
- `docs/architecture/README.md`, Browser tab paragraph: say which dialogs count.
- No change to `command-strip.tsx`, main process, preload, or IPC. No diagram change: no component, boundary
  or data flow changes, so the system-change SVGs are skipped as a local edit.

Invariants: an open dialog, the open Command Centre card and annotation still hide the view; the view never
shows before a page commits.

## Acceptance criteria

- **AC-1** A `role="dialog"` element, or an expanded dialog-stack entry, that is `inert` or inside an `inert`
  ancestor does not count as a cover. With only the closed Command Centre card mounted, the tab is not covered.
- **AC-2** A dialog that is not inert counts as a cover: the open Command Centre card, any other
  `role="dialog"`, and a `[data-expanded]` entry in `[data-component="dialog-stack"]`.
- **AC-3** The tab is told when cover may have changed: dialogs added or removed, `inert` added or removed,
  `data-expanded` added or removed. Other attribute changes are not reported. Nothing is reported after the
  watch stops.
- **AC-4** `browser-tab.tsx` decides cover only through `browserCovered(document)` and
  `watchBrowserCover(document, …)`.

## Parts

| ID | Outcome | Criteria | Files |
|---|---|---|---|
| P1 | Cover rule ignores inert dialogs and hears attribute changes; the tab uses it; doc updated | AC-1–AC-4 | `browser-cover.ts`, `browser-tab.tsx`, `docs/architecture/README.md` |

## Verification

From `tenon/packages/app`:

```sh
bun test --conditions=solid --preload ./happydom.ts ../../../Implementations/browser-white-screen
bun test --conditions=solid --preload ./happydom.ts ./src/pages/session
bun typecheck
```

Both sets check AC-1–AC-3; `acceptance/` also checks AC-4 and that the closed card is still marked `inert`.

Baseline at `63b8ecdd`: both files fail to load (`Cannot find module '@/pages/session/browser-cover'`). A
scratch test of the current selector on `<div data-command-strip-card inert><div role="dialog">` printed
`covered = true`.

Manual: in the desktop app, open a thread, open the Browser tab, load a site, confirm the page shows; press
Ctrl+J and confirm the page hides while the card is open and returns when it closes.

## Completion evidence

Uncommitted on `claude/tor-1-agent-white-screen-7faf10` over `63b8ecdd`. P1 done.

| Check | Where | Result |
|---|---|---|
| Both task test sets + `src/pages/session` | `tenon/packages/app` | 210 pass, 0 fail (19 in the task sets, 191 in `src/pages/session`) |
| `bun typecheck` | `tenon/packages/app` | pass |
| `bun run lint` | repository root | warnings only, none in the changed files' new lines |
| Prettier on the two source files | `tenon` | pass |

AC-1–AC-4 pass in the automated sets. The closed card's real markup was not rendered: the tests use the
card's wrapper-and-dialog shape, and one acceptance test pins the `inert` binding in `command-strip.tsx`.

Test change after the freeze: both files imported `@/pages/session/browser-cover`. The `@/` alias resolves
only for files inside `tenon/packages/app`, so the import failed from `Implementations/` with the module
present. It is now the relative path. No assertion changed; this is test setup, not AC-1–AC-4.

Review panel, round 1, on the uncommitted tree in the shared checkout (read-only, no worktrees): R1 plan
conformance 10, R2 correctness and regressions 10, R3 integrity and scope 10. All three Opus 5.5, medium
effort. Notes left open: on close the page may show for the card's fade-out if the card overlaps it; the
`dialog-stack` half of the selector matches nothing in the real app (open dialogs cover through their own
`role="dialog"`).

Desktop check, 28 Nov 2026, `bun run dev` from this worktree on Windows: in a new thread the Browser tab
loaded `example.com` and showed the page. Ctrl+J hid the page (the stage went white) while the Command Centre
card was open, and Escape brought it back. No screenshot of the unfixed build was taken; the white stage with
the card open is the same state the bug left the tab in permanently.

Not verified: macOS. `bun run check` was not run in full (no build, no full test run).

