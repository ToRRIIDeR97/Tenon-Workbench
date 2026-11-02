# Build plan: Notes vault, Command Centre agent, dictation

Status: planned 2026-11-02. Designs and decisions are on the design canvas
(private Claude artifact `PcvPbxAZma5gfTEcuRqkcM`); this file is the order of
work. Each phase is its own branch and pull request. Before a phase that
changes components, interfaces or data flows, draw its current and proposed
system (tor-system-change-diagram) and update `docs/architecture`,
`docs/security/threat-model.md` and `docs/architecture/uml.md` in the same
change.

## Decisions

| Area | Decision |
| --- | --- |
| Note storage | One vault per machine: `Documents/Tenon/<workspace>/<project>/`. Readable folder names, each with a stable ID. Project folders are never written to. |
| Sync | Reuse Harness Sync's approach (Google Drive for desktop folder + tray watcher). No machine paths in the vault, one writer per log file, conflict copies shown, overwritten files kept. |
| Migration | Notes in `<workspace>/notes` and `.tenon/projects/*/notes` move into the vault once, after a backup. |
| Notes layout | F: page tree; a Project page opens on Timeline with Board, Table, Docs and Log tabs. Every item is a Markdown page; a database is a folder of pages sharing properties. |
| Sidebar | S4: rail and Projects panel share one outlined container in the old neutral colour; opening widens it (300 ms, emphasized-decelerate), closing narrows it (200 ms, emphasized-accelerate). |
| Agent tools | Extend the existing `tenon` MCP server (`packages/core/src/harness/browser-tools.ts`) so every harness gets them. Project agents are limited to their own Project. |
| Write previews | W5 (inline card) for project agents; W3 (step list) and W4 (top pill) for the Command Centre. One shared preview for note, Google Tasks, calendar, timeline and email draft. Every write offers Open and Undo. |
| Command Centre | Replaces Activity. Fresh thread per request; its threads are a separate kind from project threads. Default harness and model are its own settings. |
| Memory | All Command Centre threads stored; recent ones searched raw (SQLite FTS5); after a set age (default 45 days) summarised, then the originals deleted. |
| Quick access | The Command Centre agent opens from any page with Ctrl+J / Cmd+J. Variant (K1–K4) still to choose. |
| Email | Provider-neutral tools (search, read, summarise, draft). Gmail, then Outlook through Microsoft Graph, then IMAP. Drafts only, never send. |
| Routines | Their own page; definitions stored as vault pages; run by the local server while the app is open; a missed run runs once at next launch. |
| Project setup | tor-project-setup, tor-implementation, tor-feature-map-verification, tor-workflow. |
| Dictation | Built in: a Rust engine process on Handy's `transcribe-cpp`, `handy-recorder` and `earshot` (MIT, CJ Pais), credited in Settings › Dictation and the licence notices. |

## Phases

```
1 Sidebar S4 ───────────────────────────────────────────── (independent)
2 Vault ──┬─ 3 Notes F (3a–3d)
          ├─ 4 tenon MCP app tools ──┬─ 5 Write previews
          │                          └─ 6 Command Centre ──┬─ 7 Email
          │                                                └─ 8 Routines
          └─ 9 Vault sync
10 Dictation ───────────────────────────────────────────── (independent)
```

Phases 1, 2 and 10 can run in parallel.

### 1. Sidebar S4
Renderer only (`components/second-brain-sidebar.tsx`). One container for rail
and panel, neutral surface (drops the panel's blue tint from the UI polish
branch), width transition with reduced-motion fallback. Check: `bun run
test:routes`, screenshot both states, light and dark.

### 2. Vault foundation
- Vault root from `app.getPath("documents")` + `Tenon`. On Windows this follows
  OneDrive's Documents redirection and on macOS iCloud "Desktop & Documents":
  say so in onboarding and let the user move the vault.
- `knowledge` domain service for workspaces, Projects and pages with IDs;
  machine-local map of Project ID to code folder in app data, never in the vault.
- One-time migration with backup; old locations read until it completes.
- Conflict-copy detection (`(conflicted copy)`, `-DESKTOP-…`) surfaced in Notes.
- Docs: new data location and trust boundary in the threat model; UML store view.

### 3. Notes F
3a page tree and editor (reuse `note-editor`), 3b front-matter properties with
Table and Board views, 3c Timeline (Gantt) view, 3d calendar view tied to the
existing calendar. The Notes page replaces the current list + project checkboxes.

### 4. `tenon` MCP app tools
`notes.read/search/write`, `timeline.update`, `tasks.create` (existing Google
Tasks write access), `calendar.list/propose/apply`, `threads.list/start`,
`project.setup`. Each write records a revision for Undo and emits a write event
for the previews. Project-scoped tokens for project agents. Workspace content
stays data, never instructions.

### 5. Agent write previews
Shared preview component for the five write types; W5 inline card in threads,
W3 step list and W4 pill for the Command Centre; Undo through the phase 4
revisions. Reduced motion shows the result without typing.

### 6. Command Centre agent
Page D in place of Activity; quick-access surface (K variant); separate thread
kind excluded from project lists; settings for default harness, model and
memory age; memory store with FTS5 and summarise-then-delete job (warn when the
age is lowered); project setup flow with the tor skills.

### 7. Email
Mail module in the desktop main process beside `google-calendar.ts`: Gmail
(extra Google scopes; personal OAuth client in test mode avoids Google's
restricted-scope review), Microsoft Graph with MSAL (work tenants may need admin
consent), IMAP with app passwords. Secrets in `safeStorage` on both platforms.
Settings › Accounts. Drafts only.

### 8. Routines
Routines page; definitions as vault pages (prompt, schedule, harness, allowed
tools); scheduler in the local server; catch-up run at launch; results to the
Inbox page with a notification. Tray and launch-at-login are a later step.

### 9. Vault sync
Harness Sync integration or Tenon's own watcher on a Drive for desktop folder;
keeps the previous version of any file a sync overwrites.

### 10. Dictation
Rust engine process (stdio protocol, supervised by the Electron main process);
models downloaded from Settings › Dictation; composer mic button and
hold-to-talk shortcut. macOS: `NSMicrophoneUsageDescription` and the mic
permission prompt; Windows: detect the microphone privacy setting and link to
it. Adds a Rust build for Windows and macOS to the release workflow. Handy's
MIT notice in the third-party licences.

## Open items
- Quick-access variant: K1 edge tab, K2 bar that grows, K3 bottom sheet, K4 rail button.
- Read access for the Command Centre to project threads (proposed: read-only, on request).
- Whether Harness Sync carries the vault or Tenon syncs it itself.
