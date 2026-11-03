# Projects page as one page (workshop variant B)

## Problem

From the workshop audit (`https://claude.ai/artifact/Xir5jJPPYwW3ZML1BdndaG`, board 1):

- Two trees side by side: the sidebar lists Projects with threads, and the page lists them again with pages.
- Unlabelled add buttons: a bare "+" makes a page, and there is no way to add a page inside a Project.
- Tasks are "items" with a Kind dropdown, and can only be added on three of the seven tabs.
- The add form uses native `<select>` controls and native `<input type="date">` fields.
- Start work hides in Details, and a Project's threads aren't on its page.

Decided (chat, 2026-11-03): build workshop variant **B, Project as one page**.

Before: Acme API opens on a Timeline tab with six more tabs, and its pages can only be added from the tree's "+".
After: Acme API is one scrolling page. A sticky bar jumps to Tasks, Pages, Threads, Log and Settings and holds
Start work. Tasks has a quick-add line, Pages has a New page card, and Threads has New thread.

## Scope

- `app/src/pages/projects.tsx`: the landing (Projects, Archived, General pages, search, New Project, New page,
  All projects) and the routing between the landing, a Project, a page and the New Project form. The inner page
  tree goes.
- `features/second-brain/project-view.tsx` (replaces `notes-project.tsx`): the one-page Project.
- `features/second-brain/project-controls.tsx`: `DateChip` (popover with quick picks and a month grid),
  `StatusMenu` (`MenuV2` radio items) and the Task/Milestone switch (`SegmentedControlV2`).
- `features/second-brain/project-details.tsx`: the Settings section. Start work moves to the sticky bar.
- `notes-tree.tsx` is removed. The page view (`notes-page.tsx`) is unchanged.
- Out of scope: the Calendar page's own forms (they still use native date fields), and the sidebar.

## Acceptance criteria

- **AC-1 Landing.** `/projects` with nothing open lists active and paused Projects as rows (name, outcome,
  progress, next milestone), Archived (folded), and General pages (pages tied to no Project). It has search,
  **New Project**, **New page** (a General page) and **All projects**.
- **AC-2 One page.** `/projects?project=<id>` shows the title, outcome, progress and next milestone, and a sticky
  bar with links to Tasks, Pages, Threads, Log and Settings, plus **Start work**. There are no tabs.
- **AC-3 Tasks.**
  - A list with an Open/All switch. A checkbox marks a task done or not done.
  - A status pill opens a menu (To do, Doing, Done).
  - The always-ready "Add a task" line adds on Enter, with a date chip and a Task/Milestone switch.
  - The timeline strip sits below the list. Every change is saved through the existing timeline write.
- **AC-4 Pages.** A grid of the Project's pages. A **New page** card creates a page in this Project and opens it;
  Back returns to the Project.
- **AC-5 Threads.** The Project's recent root threads link to the thread view. **New thread** starts a draft in
  the Project's folder.
- **AC-6 Log and Settings.** Log lists entries newest first. Settings (folded) holds the Details form.
- **AC-7 App-styled controls.** The Projects page renders no `<select>` and no `<input type="date">`.
- **AC-8 Old links.** `?tab=` maps to a section: timeline, board, table and calendar → Tasks, docs → Pages,
  log → Log, details → Settings, opened. Agent-write Open links use `?section=`, and `/notes…` still redirects.
- **AC-9** `bun run check` and `bun run test:routes` pass, and the updated specs pass.

| AC | Check |
|---|---|
| AC-7, structure | `acceptance/app/one-page.test.ts` (source checks, the section map) |
| AC-1 … AC-6, AC-8 | e2e `notes-f.spec.ts` (rewritten for the one page), `functional-audit-fixes`, `agent-writes` |
| AC-9 | commands |

## Completion evidence

Implemented as planned. Notes:

- Start work moved from the Settings form to the sticky bar.
- The agent-write Open link for the log uses `&section=log`.
- The previous plan's acceptance test (`merge-notes-projects`) drops its tree and tab checks, which this plan
  supersedes.
- `notes-tree.tsx` and `notes-project.tsx` are removed. The week grid moved into `project-view.tsx`. The Project's
  Board, Table and Calendar views are gone: the task list (with its status menu) and the timeline cover them, and the
  Calendar page shows dates.

Checks run (same author):

- Acceptance set: 7 pass, plus the updated `merge-notes-projects` set: 3 pass.
- `bun run check`: pass (lint 0 errors; 4,109 warnings, none in the new files).
- `bun run test:routes`: 11 pass.
- Playwright: 48 pass across `notes-f` (rewritten for the one page, including a quick-add with the date picker and a
  status change through the menu), `command-centre`, `agent-writes`, `routines`, `sidebar-s4`,
  `functional-audit-fixes` (the New page and Archive tests rewritten), `notes-vault-errors`,
  `agent-writes-reduced-motion`, `brain-home-loading` and `brain-home-model-picker`.
- Web preview (isolated server):
  - the landing shows Projects, All projects and General, with New page and New Project;
  - a Project shows the sticky bar and every section;
  - the date picker opened with today marked, and picking the 13th then pressing Enter added a task dated
    "Fri, Nov 13", which also appeared on the timeline;
  - the status menu set Doing, and the checkbox marked the task done (the Open filter then hid it);
  - New page created `Acme API/Untitled.md` and opened it, and Back returned to the Project;
  - no native `<select>` or date input was rendered.

Not changed: the Calendar page's own event and task forms still use native date fields.
