# One Projects page: merge Notes and Projects

## Problem

A Project has two homes, so it is unclear where to go:

- `/projects` (Projects page): a list with an Active/Paused/Archived filter, a create form, and per Project
  the Overview, Plan, Work, Files, Activity and Map views.
- `/notes?project=…` (Notes): a page tree, and per Project the Timeline, Board, Table, Calendar, Docs and Log
  tabs.

Several views repeat each other: Plan and Calendar, Map and Docs, Work/Activity and the thread list. The
Notes page also holds far more than notes (Project hubs, Routines, Inbox, agent logs).

Decided (chat, 2026-11-03), building on the 2 Nov design decision F: one page named **Projects**.

- The rail item "Notes" becomes "Projects" at `/projects`.
- The tree lists Projects with their pages, archived Projects folded, and **General** for pages without a
  Project.
- A Project opens on Timeline with Board, Table, Calendar, Docs, Log and a new **Details** tab holding the
  old Overview form.
- New Project lives in the tree's header. The old Projects page is removed, and `/notes` links redirect.

Before: "Acme API" is under Projects (Overview) and under Notes (Timeline). After: one `/projects?project=…`
page with every tab.

## Feature map

| Piece | Today | Source |
|---|---|---|
| Notes page | Tree, Project tabs, page editor, migration, conflicts | `pages/notes.tsx`, `features/second-brain/notes-*.tsx` |
| Projects page | List and filter, create form, Overview (form, status, archive with Undo, Start work), Plan, Work, Files, Activity, Map | `pages/projects.tsx` |
| Project records | Sidebar query (`useBrainProjects`), refreshed by `invalidateProjectThreads` | `components/sidebar/sidebar-controller.ts` |
| Rail | `notes` item → `/notes` | `components/second-brain-sidebar.tsx` |
| Links in | Agent write cards, Routines, All projects, Home, sidebar menu, shortcuts, wiki links | `agent-writes/store.tsx`, `pages/routines.tsx`, `pages/project-overview.tsx`, `brain-home.tsx`, `second-brain-sidebar.tsx`, `sidebar-controller.ts`, `note-editor.tsx` |

Removed with the old page: the Plan, Work, Files, Activity and Map views. The Calendar, Docs and Log tabs and the
thread list cover them. `projectGraph` is used only by Map.

## Acceptance criteria

- **AC-1 One rail item.** The rail reads Home, Projects, Calendar, Command Centre, Settings
  (`data-sidebar-item="projects"` → `/projects`). There is no Notes item.
- **AC-2 One page.** `/projects` shows the tree, its header reading "Projects". The tree has a Projects group
  (non-archived Projects, each with its pages), an Archived group (folded) when any Project is archived, and a
  General group (pages without a Project).
- **AC-3 Project tabs.** `/projects?project=<id>` opens on Timeline, with Board, Table, Calendar, Docs, Log
  and Details tabs. Details holds the outcome, Start work, progress, next milestone, blocker and the settings
  (outcome, instructions, tags), with Save/Discard, Pause/Resume and Archive (with Undo). Leaving with unsaved
  edits is blocked.
- **AC-4 New Project.** The tree's New Project button and `/projects?new=1` show the create form. Creating
  opens the new Project.
- **AC-5 Redirects and links.** `/notes`, `/notes?project=…`, `/notes?page=…` and `/notes?note=…` redirect to
  the same view under `/projects`. In-app links point to `/projects`. Wiki links in pages still open.
- **AC-6** `bun run check` and `bun run test:routes` pass, and the updated specs pass.

| AC | Check |
|---|---|
| AC-1, AC-2, AC-5 | `acceptance/app/merge.test.ts` (source and route checks), e2e `sidebar-s4`, `notes-f` |
| AC-3, AC-4 | e2e `notes-f` (Details tab, New Project) |
| AC-6 | commands |

## Verification

From `tenon/packages/app`: `bun test --conditions=solid --preload ./happydom.ts ../../../Implementations/merge-notes-projects/acceptance/app/`
and the affected Playwright specs. From the root: `bun run check`, `bun run test:routes`.

## Completion evidence

Implemented as planned. Beyond the plan:

- The Project view now shows the outcome under its title, because Home's Projects card opens Timeline. Details
  no longer repeats it.
- The landing view (nothing open) gets the old list's **All projects** row.
- `projectGraph` (used only by the removed Map view) and the old `pages/projects.test.ts` are removed.
- The command id `navigate.notes` became `navigate.projects` ("Go to Projects"). A custom shortcut bound to the
  old id needs rebinding.

Checks run (same author):

- Acceptance set: 6 pass.
- `bun run test:unit` (app): 931 pass.
- `bun run check`: pass. Lint warnings went from 4,113 to 4,107.
- `bun run test:routes`: 11 pass.
- Playwright: `notes-f` (with new tests for the redirect, Details and New Project), `sidebar-s4`, `command-centre`,
  `agent-writes`, `routines`, `functional-audit-fixes` (archive restores from the Archived group; Docs open a page),
  `notes-vault-errors` and `brain-home-routing` all pass.
- Web preview (isolated server):
  - New Project created "Acme API" and opened it, with its outcome and all seven tabs;
  - the rail reads Home, Projects, Calendar, Command Centre, Settings;
  - Details shows Start work, progress, milestone, blocker, settings, Pause and Archive;
  - `/notes?project=…&tab=board` landed on `/projects` with Board selected.

Docs updated: `docs/product/NAVIGATION-MAP-V1.md`, `docs/architecture/README.md` (Projects page) and
`docs/architecture/uml.md`.
