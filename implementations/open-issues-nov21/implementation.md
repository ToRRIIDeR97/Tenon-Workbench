# Open issues, 21 Nov: #310, #328, #329, #331, #259

Base: `main` at `3e6495df`. Branch: `claude/open-issues-nov21`. One agent wrote the plan, the tests and the code
(TOR-1); the verification tests aren't independent.

## What was already done (checked against `main`, not re-done)

| Issue | Already on main | Real gap left |
| --- | --- | --- |
| #310 | Alias model ids resolve (`resolveModel`); a harness report without a window shows tokens, no share | Ring and Context tab disagree when a harness hasn't reported context but a window is known: the ring says "Not reported", the tab shows `used / window · NaN%` and a "used of window" row |
| #328 | Caption only grows (`mergeCaption`); "Finishing…" while the final pass runs | The final transcript silently replaces what was shown; the spoken language used is never shown |
| #329 | Ctrl/Cmd+J in the command palette; waiting queue and running threads on the card; New thread | No model/harness pill; replies always go to the newest thread; the shortcut isn't shown on the card; `send()` takes the harness for a reply from the pill instead of the thread |
| #331 | Issues as tasks with their closing PR; Repository card | A PR can't be traced to the thread that produced it |
| #259 | The three finished upgrades (minimatch, happy-dom, actions v7) | The minor/patch batch; the majors |

## Map (causal path)

- #310: `session-context-metrics.ts` `build()` → `Context { total, limit, usage, reported, compacted }` →
  `context-strip.tsx` ring label (checks `reported`, `usage`) and `session-context-tab.tsx` header/row (checks only
  `limit`, then `percent(usage)` → `NaN%` when `usage` is null). Fix at the shared step: one readout both read.
- #328: engine `partial` → `dictation-button.tsx` `mergeCaption` → caption; `finish()` → `stop()` → `insertAtCaret(final)`.
  Language: `dictationLanguage(setting, locale)` → `start({ language })`; never rendered.
- #329: `command-strip.tsx` `createComposerController.send` → `centre.send(text, latest | null)` with no choice;
  `command-centre.tsx` `send()` picks `harness` from `choice ?? settings` even when replying to an existing thread.
- #331: `core/src/github/work.ts` `forLocation` → `{ issues, pulls }` → `server/src/handlers/github.ts` → app
  `projectGithubWork` → `githubTaskRows` → `ProjectGithubTasks`. Threads keep PR URLs in their messages
  (`session_message.data`, `part.data`) when an agent runs `gh pr create` or cites the PR.

## Parts

| Part | Outcome | Criteria | Files | Depends |
| --- | --- | --- | --- | --- |
| P1 | Ring, context menu and Context tab show the same readout; no `NaN%`, no window share without a report | AC-1, AC-2, AC-3 | `session-context-metrics.ts`, `context-strip.tsx`, `session-context-tab.tsx` | — |
| P2 | The live caption names the language in use; a final transcript that differs from the caption says how many words changed and can be swapped back to what was shown | AC-4, AC-5, AC-6 | `dictation-review.ts` (new), `dictation-button.tsx`, `en.ts` | — |
| P3 | The card shows and sets the harness/model for a new thread, shows a reply's thread harness, switches the reply thread, and shows the shortcut; replies keep their thread's harness | AC-7, AC-8, AC-9 | `command-strip.tsx`, `command-strip-target.ts` (new), `command-centre.tsx`, `en.ts` | — |
| P4 | Each PR carries the thread whose messages first mention it; the GitHub task row opens that thread | AC-10, AC-11, AC-12 | `core/src/github/work.ts`, `core/src/github/threads.ts` (new), app `github-tasks.ts`, `project-github-tasks.tsx`, `en.ts` | — |
| P5 | Every dependency at its newest same-range release that passes the 3-day rule, except the documented exclusions; all checks pass | AC-13, AC-14 | `tenon/package.json`, `tenon/packages/*/package.json`, `tenon/bun.lock` | P1–P4 merged first, so their checks run on the old deps |

## Acceptance criteria

- **AC-1** Unreported context with a known window: the readout is "unreported" with the token total and no window or
  share; the ring, menu and tab all render it so (no `NaN%`, no "used of window").
- **AC-2** A reported context with no window: tokens, no share, in all three.
- **AC-3** A reported context with a window: the same share and window in all three; compacted stays compacted.
- **AC-4** The caption shows the language dictation runs with: its name for a code (`en` → English), "Detect" when
  the model detects it.
- **AC-5** Changed words between caption and final ignore case and punctuation; an empty caption counts as no change.
- **AC-6** "Use what I saw" swaps the just-inserted final text for the caption when it is still right before the
  caret, and changes nothing when it isn't (the user typed or moved on).
- **AC-7** The reply target is the chosen thread when it still exists, else the newest; New thread targets none.
- **AC-8** A new thread uses the pill's harness and model; a reply uses its thread's own harness (the pill can't send
  a built-in prompt to a harness thread or the reverse).
- **AC-9** The card shows the pill (new thread) or the thread's harness and model (reply), a thread switcher, and the
  Ctrl/Cmd+J shortcut.
- **AC-10** A PR maps to the earliest Project thread whose messages contain its URL; other repositories, issue URLs
  and look-alike hosts don't count; `…/pull/12/files` counts as #12; owner/repo match ignores case.
- **AC-11** `forLocation` attaches `thread: { id, title }` to those PRs, from the Project folder's own threads.
- **AC-12** The GitHub task row shows "From <thread>" for its PR and opens that thread.
- **AC-12b** (added in verification, loop-back to step 1) A PR that closes none of the listed issues is a row of its
  own with its thread: open ones under Open, merged and closed ones under All. Without it a PR with no issue never
  appeared on the Project page, so #331's "shows its PRs" and "a merged PR is traceable" failed for it.
- **AC-13** Every package in `tenon/` is at the highest version satisfying `^current` that is at least 3 days old,
  except: patched packages, `@ai-sdk/google-vertex` (waits for patched `@ai-sdk/google`), `@tanstack/solid-query`
  (<5.100), `@solidjs/meta` (0.29.4), `@solid-primitives/storage` (4.3.x), `ghostty-web` (git), overrides, and
  `prettier` (a minor release reformats the repository; its own PR). Amended during P5 (see "Test changes after
  the freeze"): packages bound to a patched package (`@tanstack/solid-virtual`, `@effect/*`), prerelease pins
  (`drizzle-orm`/`drizzle-kit` rc.5, `@clack/prompts` alpha, `@lydell/node-pty*` beta), `@pierre/diffs` (1.6 pairs
  with diff 9) and `@tsconfig/bun` (1.0.12 needs `@types/bun` in the root package). The OpenTelemetry exporter moves
  0.214 → 0.223.2, the release paired with SDK 2.12.1.
- **AC-14** `bun install --frozen-lockfile`, `bun run check` and `bun run test:engine` pass (engine: only the known
  Windows failures and the git timeouts that also fail on `main` here); `bun audit` reports no more advisories than
  before.

## Tests (frozen after the baseline run)

| Criterion | Acceptance | Verification |
| --- | --- | --- |
| AC-1–3 | `app/src/components/session/session-context-readout.test.ts` | `.../session-context-readout.verify.test.ts` (ring/menu/tab read the readout) |
| AC-4–6 | `app/src/components/prompt-input/dictation-review.test.ts` | `.../dictation-review.verify.test.ts` (button wiring) |
| AC-7–9 | `app/src/features/command-centre/command-strip-target.test.ts` | `.../command-strip-target.verify.test.ts` (card wiring) |
| AC-10–12 | `core/test/github-threads.test.ts`, `app/src/features/second-brain/github-tasks.test.ts` (added cases) | `core/test/github-threads.verify.test.ts` (SQL over a real database) |
| AC-13–14 | `implementations/open-issues-nov21/verification/dependencies.ts` | the standard checks |

## Not in scope

The #259 majors (AI SDK 7, Vite 8 + electron-vite 6, Sentry 11, Solid Router 2, Solid 2, TypeScript 7, electron-store
12, htmlparser2 12, imapflow 2, diff 9, glob 14 / minimatch 11, google-auth-library 11, npm CLI libraries, Prettier
3.10, re-ported patches) each need their own migration; they stay on #259.

## Completion evidence

_Filled in after verification._
