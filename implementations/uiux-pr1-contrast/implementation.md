# UI/UX PR1: contrast and keyboard fixes

Source: the 12 Nov 2026 UI/UX panel (review board "Tenon UI/UX Review", rollout step 1).
Branch `claude/uiux-pr1-contrast` from `origin/main` at `e2867042`. One agent (TOR-1) wrote the plan,
tests and code; the verification set is not independent.

## Feature map

| Trigger | Failure (baseline) | Expected | Causal path |
|---|---|---|---|
| Light theme, any warning (approval title, routine chip, sidebar) | `#cb9f34` on `#fefaec`, 2.35:1 | ≥ 4.5:1 | `oc-2.json` light `v2-state-fg-warning` → `yellow-800` |
| Dark theme, faint text | `#a3a3a3` vs muted `#aeaeae`, nearly equal | faint a visible step below muted, ≥ 4.5:1 on base and layers 1–2 | `oc-2.json` dark `v2-text-text-faint` |
| Tab to the composer's send button | no ring (`outline: none`) | the shared 2px focus ring | `PromptInputV2SubmitButton` class (session-ui prompt-input) |
| Tab to an attachment's remove button | button stays invisible (`opacity-0`, hover only); 16px; image opens only by mouse | visible on focus-within, 20px; image is a button | prompt-input attachment and comment chips |
| Tab to a project card's New thread / actions | 20×20, 2px ring outside the button is clipped by the `overflow-hidden` actions strip | 24×24, ring drawn inside | `second-brain-sidebar.tsx` header actions |
| Changed-files "Show all" in a turn | `<span onClick>`, unreachable by keyboard, invisible until hover | a button, visible on focus-within | `message-timeline.tsx`, `session-turn.css` |
| Connect-provider dialog fields | `gap-2px-3`, `gap-2font-medium` are not classes: label sits ~4px from field | 8px gap | `dialog-connect-provider.tsx` |

Consumers checked: every theme other than OC-2 keeps its own tokens (out of scope); copy buttons in the thread
already show on `focus-within` (no change needed, the reviewer's "hover-only" holds for mouse discoverability only).

## Parts

| ID | Outcome | Criteria | Files | Depends on |
|---|---|---|---|---|
| P1 | Warning and faint tokens pass contrast | AC-1, AC-2 | `ui/src/theme/themes/oc-2.json` | – |
| P2 | Composer send ring, remove buttons, image button | AC-3, AC-4 | `session-ui/src/v2/components/prompt-input/index.tsx` | – |
| P3 | Sidebar card actions 24px with inset ring | AC-5 | `app/src/components/second-brain-sidebar.tsx` | – |
| P4 | Show all is a keyboard button | AC-6 | `app/src/pages/session/timeline/message-timeline.tsx`, `session-ui/src/components/session-turn.css` | – |
| P5 | Connect-provider label gaps | AC-7 | `app/src/components/dialog-connect-provider.tsx` | – |

## Acceptance criteria

- AC-1 OC-2 warning text ≥ 4.5:1 on the warning fill and on the page, light and dark.
- AC-2 OC-2 dark faint ≥ 4.5:1 on base, layer 1, layer 2; muted/faint contrast ratio ≥ 1.15.
- AC-3 Send button draws the 2px focus ring on keyboard focus.
- AC-4 Remove buttons 20px and visible on focus-within; image attachments are buttons.
- AC-5 Project card actions 24px, focus ring inset (-2px).
- AC-6 Changed-files Show all is a `<button>`, visible on focus-within.
- AC-7 No invalid gap classes in the connect-provider dialog.

Tests: `acceptance/` = `ui/src/theme/themes/oc-2-contrast.test.ts` and `app/src/uiux-pr1-keyboard.test.ts`
(copies here). `verification/live.mts` measures computed styles in the running dev app (headless Chromium
under Node).

## Completion evidence

Base `e2867042`. Tests frozen after the baseline run (copy outside the repo); no test file changed after the
freeze (`diff` against the frozen copy is empty). Verification setup was fixed twice before the freeze (how
the headless run opens the workspace and reaches a thread composer), not its assertions.

| Check | Baseline | Final |
|---|---|---|
| `ui` `oc-2-contrast.test.ts` (AC-1, AC-2) | 2 fail | 4 pass |
| `app` `uiux-pr1-keyboard.test.ts` (AC-3–AC-7) | 6 fail | 6 pass |
| V1 light warning on fill (live) | 2.35:1 | 6.88:1 |
| V1 dark warning on fill (live) | 6.78:1 | 6.78:1 |
| V2 dark faint (live) | `#a3a3a3`, muted/faint 1.14 | `#9c9c9c`, 4.95:1 on layer 2, muted/faint 1.24 |
| V3 thread send focus | `outline: none` | 2px solid focus ring |
| V5 project card actions | 20×20, ring offset +2px (clipped) | 24×24, ring offset −2px |

Decisions during implementation:
- Faint first went to `#999999`; the repo's `contrastRatio` weights green 0.587 (not WCAG's 0.7152), which put it
  at 4.44:1 on layer 2, so it moved to `#9c9c9c` (4.60 by the repo helper, 4.95 by WCAG).
- The remove buttons keep their `-top-1 -end-1` position; only the size and focus visibility changed.
- Home's composer (`ComposerBox`) already had a focus ring; the missing one was the thread composer.

Not verified live: attachment remove buttons and image button (needs an attachment), changed-files Show all
(needs a finished turn with diffs; turns stall in the dev setup), connect-provider label gaps. These rest on
the source-level acceptance tests. Copy buttons in the thread already show on `focus-within`; no change.
