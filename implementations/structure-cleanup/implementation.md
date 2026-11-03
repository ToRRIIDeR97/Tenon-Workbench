# Structure cleanup: dead code and duplicate versions

Steps 2 and 3 of the component-reuse review that followed `Implementations/shared-composer/`.

## Problem

Dead modules and unreachable old versions sit next to live code. An edit to a dead or legacy copy never
reaches the screen, and readers can't tell which copy is real.

Before: `SortableTab` and `SortableTabV2` both exist, and the side panel renders both under a condition
that is always true for the v2 branch. After: one tab component, one drag-and-drop library.

## Feature map

| Item | Evidence it is dead or duplicated | Source |
|---|---|---|
| Old Home session list | `HomeSessions` has no importer; its view, scroll and search controllers are imported only by it | `pages/home/home-sessions*.tsx`, `home-scroll-controller.ts`, `home-session-search-controller.ts` |
| Edit-project dialog v2 | `DialogEditProjectV2` has no importer; `edit-project.ts` is imported only by it | `components/dialog-edit-project-v2.tsx`, `components/edit-project.ts` |
| Note client functions | `listNotes`, `readNote`, `writeNote`, `deleteNote` have no caller | `features/second-brain/client.ts` |
| Run status | Home re-implements `agentRunStatus` inline (`status !== "idle"` or approvals) | `pages/brain-home.tsx` `runningSessions`, `pages/activity-runs.ts` |
| v1 sortable tab | `SessionSidePanel` is rendered once (`pages/session.tsx`), always with `fileBrowserState`, so its `fallback` branch (solid-dnd provider, `SortableTab`) never renders | `pages/session/session-side-panel.tsx` `<Show when={props.fileBrowserState} fallback=…>` |
| solid-dnd helpers | `utils/solid-dnd.tsx` is used only by that fallback branch | `utils/solid-dnd.tsx` |
| Legacy `NewSessionView` | The session page is routed only at `/server/:serverKey/session/:id`, so `params.id` is always set and `<Match when={true}>` never renders | `app.tsx` routes, `pages/session.tsx` |

Left for later (live, visible changes): the Files panel still uses the v1 `FileTree`, and web mode still uses
the v1 folder picker (`components/directory-picker.tsx`). Moving either changes what the user sees.

## Acceptance criteria

- **AC-1** The dead modules above are deleted and nothing imports them.
- **AC-2** Home's running list uses `agentRunStatus` from `pages/activity-runs.ts`.
- **AC-3** `SortableTab` (v1), the side panel's unreachable solid-dnd branch, `utils/solid-dnd.tsx` and the
  `@thisbeyond/solid-dnd` dependency are removed; `FileVisual` moves into `session-sortable-tab-v2.tsx`.
- **AC-4** The legacy `NewSessionView` and its unreachable `<Match>` are removed.
- **AC-5** No behaviour change: `bun run check` passes, `bun run test:routes` passes, the side-panel and
  Home specs pass, and the session benchmarks stay comparable to the baseline.

AC-1 to AC-4 are checked by `acceptance/app/structure-cleanup.test.ts`, which reads the source. AC-5 is
checked with the commands below. There is no separate verification set: this is a deletion with no new
behaviour, so the behaviour checks are the repository's existing suites.

## Verification

From `tenon/packages/app`:

```sh
bun test ../../../Implementations/structure-cleanup/acceptance/app/
PLAYWRIGHT_WORKERS=1 bunx playwright test --config e2e/performance/playwright.config.ts
```

From the repository root: `bun run check`, `bun run test:routes`.

`bun run test:bench` stops at a unit test that already fails on `main`
(`e2e/performance/unit/mock-server.test.ts`: the stubbed route has no `isNavigationRequest`), so the
Playwright benchmarks are run directly.

## Completion evidence

Implemented as planned, with these extras found while removing the v1 branch:

- `getTabReorderIndex` (and its test) was used only by the solid-dnd branch, so it is removed.
- `env.d.ts` declared the `use:sortable` directive for solid-dnd. The declaration is removed, and
  `export {}` keeps the file a module, as it was.
- `NoteDocument` had no users once the note functions were gone, so it is removed.
- `bun install` also rewrote the `ghostty-web` integrity hash in `bun.lock`. That unrelated line is restored.

Checks run (same author):

- Acceptance set: 6 pass.
- `bun run check`: pass. Lint warnings went from 4,121 to 4,114.
- `bun run test:routes`: 11 pass.
- Playwright `review-open-file`, `review-line-comment`, `brain-home-loading`, `brain-home-model-picker`
  and `command-centre`: 15 pass.
- Benchmark: not recorded. `bun run test:bench` stops at the already-failing
  `e2e/performance/unit/mock-server.test.ts`. Running the Playwright benchmark config directly fails to
  load a `bun:` import under Node's ESM loader before any scenario runs. Both happen on `main`. The
  session-page edits only remove branches that never render.
