# PR6: Command Centre docked card

Source: the composer workshop (docked card, direction A2) and the user's decisions on 12 Nov 2026:
- a send from the card replies to the thread it shows (New thread starts a fresh one);
- pending questions count as "needs you" everywhere;
- approvals are answered in the thread: the card offers "Review in thread", not Allow once.

Branch `claude/uiux-pr6-command-card`, stacked on PR5 (`c9fc315e`). One agent (TOR-1) wrote plan, tests and code.

## Feature map

| Trigger | Baseline | Expected | Causal path |
|---|---|---|---|
| Ctrl/Cmd+J | 680px, 16px card, no name; one line of the reply only | 640px, 24px card named "Command Centre"; your last message and the reply (3 lines) | `command-strip.tsx` |
| Send from the card | always a new thread (`centre.send(text, null)`) | replies to the shown thread; New thread button for a fresh one | `command-strip.tsx`; `centre.send` already takes a target |
| Draft | lost on close; the page's is persisted (`composer.command`) | one shared persisted draft | `createComposerController({ persist })` |
| An approval or question waits | "Open the thread to answer" text, approvals only | a "Review in thread" button; questions count | `command-centre.tsx` `waiting`; `activity-runs.ts` |
| Sidebar and Home "needs you" | approvals only | approvals + questions | `sidebar-controller.ts`, `brain-home.tsx` |

Not in this PR: tray icon and system-wide shortcut, model chip in the card, a cross-project running list.

## Parts

| ID | Outcome | Criteria | Files |
|---|---|---|---|
| P1 | `needsYou` counts approvals and questions | AC-1 | `pages/activity-runs.ts`, `sidebar-controller.ts`, `brain-home.tsx`, `command-centre.tsx` |
| P2 | Card shows ask and reply; replies to the shown thread; shared draft; Review in thread; shape | AC-2–AC-6 | `command-centre.tsx` (`lastAskText`, `lastAsk`), `command-strip.tsx`, `i18n/en.ts` |

Tests: `acceptance/uiux-pr6-command-card.test.ts`; `verification/live.mts`.

## Completion evidence

Baseline: acceptance file fails to load (`needsYou`, `lastAskText` missing). Live: card opens and takes focus;
680px, 16px corners, no title, no New thread; Esc closes.

After: 8/8 acceptance pass (Prettier reformatting only after the freeze). Live: Ctrl+J opens a 640px, 24px card
titled "Command Centre" that takes focus; Esc closes it. Not verified live: the exchange, Review in thread and New
thread (the test workspace has no Command Centre thread, and turns stall in this dev setup).
The sidebar controller's own `needsYou` memo was renamed `waitingCount` (still exported as `needsYou`) to avoid
shadowing the shared helper.
