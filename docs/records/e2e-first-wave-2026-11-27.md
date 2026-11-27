# App e2e: first-wave time-outs and other flaky tests (2026-11-27)

Programme phase P0 ([plan](../../implementations/mobile-sync-programme/implementation.md#p0-first-wave-e2e-time-outs)).
Base: `9538b1f6` (main). Windows 11, 20 logical processors, Playwright's default worker count (10), ports
`PLAYWRIGHT_PORT=3105 PLAYWRIGHT_SERVER_PORT=4105`, one run at a time, nothing else running except where
noted. Each run started its own Vite dev server (`reuseExistingServer` found none).

## Report

With ten workers, the first test each worker starts (dictation-web AC-2.4, agent-writes AC-6.1,
live-canvas-board AC-24, live-canvas-follow AC-9..11, live-document AC-18..19, live-tracked-edits AC-25,
notes-f AC-4.1) often timed out after 10 s waiting for the first page. Those runs (seven failures in each of
five runs of 109 tests) were made in another worktree on 2026-11-27 before it had the P3b Vite change.

## Five default-worker runs on the base

| Run | Passed | Failed | Skipped | Wall | Failed tests |
| --- | --- | --- | --- | --- | --- |
| 1 | 217 | 1 | 1 | 181 s | `regression/terminal-composer-focus.spec.ts` › routes typing to the composer unless the open terminal is focused |
| 2 | 218 | 0 | 1 | 180 s | none (a file search of mine ran alongside part of it) |
| 3 | 217 | 1 | 1 | 195 s | `regression/thread-menu-rename.spec.ts` › pressing R … Enter saves |
| 4 | 216 | 2 | 1 | 260 s | `thread-menu-rename` › pressing R …; `regression/session-timeline-transport.spec.ts` › delivers server heartbeat without mutating the timeline |
| 5 | 216 | 2 | 1 | 214 s | `regression/review-line-comment.spec.ts` › shows a comment button when a line number is hovered; `thread-menu-rename` › clicking Rename … Enter saves |

None of the seven first-wave tests failed in any of the five runs.

## Cause of the first-wave time-outs

A cold Vite dependency cache. The Markdown worker imports `shiki`, `marked`, `@shikijs/stream`, `remend`,
`katex` and `marked-shiki`, which Vite's start-up scan does not see. On the first Markdown render Vite
discovers them, re-optimizes its dependencies and tells every open page to reload. With ten workers the
first wave of pages is open at that moment, so each reloads and the test's first `toBeVisible` runs out
of its 10 s. With one worker the reload happens once, early, and the test still has time.

P3b (`e45a3a20`) already pre-bundles those dependencies (`optimizeDeps.include` in
`tenon/packages/app/vite.config.ts`). The experiment, both runs with `node_modules/.vite` deleted first and
the 92 acceptance specs at ten workers:

| `optimizeDeps.include` | Passed | Failed | Failed tests |
| --- | --- | --- | --- |
| removed (as before P3b) | 86 | 5 | live-document AC-18..19, live-tracked-edits AC-25 (two), live-canvas-follow AC-9 (history), command-centre Markdown card; each a 10 s `toBeVisible` or `toHaveCount` on rendered Markdown |
| present (main) | 91 | 0 | none |

So the reported time-outs are fixed on main; P0 adds nothing for them.

## The other flaky tests

| Test | Cause | Decision | Stress before | Stress after |
| --- | --- | --- | --- | --- |
| `thread-menu-rename` › pressing R … / clicking Rename … Enter saves | The sidebar renames optimistically: the row shows the new title before the `PATCH` reaches the test's route handler, and the test checked the recorded requests synchronously right after the title appeared | test synchronisation: the request list is now polled (`expect.poll`), the assertion is unchanged | 9 failed of 40 (`--repeat-each=20`, both save tests) | 0 of 40 (all 60 of the file passed) |
| `session-timeline-transport` › delivers server heartbeat without mutating the timeline | The "before" snapshot was taken once two polls 50 to 100 ms apart agreed, which can be before the Markdown worker has rendered the steady part (plain fallback text, then `<p>steady</p>` with a line break in `textContent`); under load the later render looked like a mutation | test synchronisation: wait until the steady part's rendered paragraph shows before taking the snapshot | 2 failed of 40 (`--repeat-each=40`) | 0 of 40 |
| `review-line-comment` › shows a comment button when a line number is hovered | not found: the hover, count, pointer-events and focus checks already retry inside `toPass` for 10 s and still missed once | unexplained, left as is | 1 failed of 10 (with two other specs, `--repeat-each=10`) | |
| `terminal-composer-focus` › routes typing to the composer unless the open terminal is focused | not found: the composer was "inactive" after a click and typing, once | unexplained, left as is | 0 failed of 10 | |

## Five default-worker runs after the changes

| Run | Passed | Failed | Skipped | Wall | Failed tests |
| --- | --- | --- | --- | --- | --- |
| 1 | 218 | 0 | 1 | 183 s | none |
| 2 | 218 | 0 | 1 | 189 s | none |
| 3 | 218 | 0 | 1 | 194 s | none |
| 4 | 217 | 1 | 1 | 189 s | `regression/home-page-stable.spec.ts` › Home stays in the page while its thread list loads |
| 5 | 218 | 0 | 1 | 247 s | none (I was editing files outside the app during it) |

Four of five runs were clean, so the five-in-a-row target was not met. The one failure is a test that
throttles the CPU eightfold on purpose (it reproduces the Home remount P3b fixed); with ten workers
sharing the machine, Home's composer did not appear within the 10 s `toBeVisible`. It is load-sensitive
by design; making it pass under load would mean a longer time-out or less throttling, which this phase
does not do. Also left as they were: the `review-line-comment` hover test and the
`terminal-composer-focus` test, which failed once each on the base and not after (rates above).

## Commands

From `tenon/packages/app`, with `PLAYWRIGHT_PORT=3105 PLAYWRIGHT_SERVER_PORT=4105`:

- full suite: `bunx playwright test --reporter=line`
- stress: `bunx playwright test e2e/regression/thread-menu-rename.spec.ts --repeat-each=20` and
  `bunx playwright test e2e/regression/session-timeline-transport.spec.ts -g heartbeat --repeat-each=40`
- cold-cache experiment: delete `node_modules/.vite`, then `bunx playwright test e2e/acceptance`, once with
  the `optimizeDeps` block removed from `vite.config.ts` and once with it.
