# UI/UX PR2: one size scale

Source: UI/UX review board, Design 1. Branch `claude/uiux-pr2-size-scale` from `main` at `ac981f8e`.
One agent (TOR-1) wrote plan, tests and code.

## Feature map

| Trigger | Baseline | Expected | Causal path |
|---|---|---|---|
| Any control | heights 24/28/32/36/40, no shared token | three named heights 28/36/44 | no size tokens in `ui/src/v2/styles/theme.css` |
| Large text field | 32px beside 36px large buttons and the 36px Settings search | 36px | `text-input-v2.css` `[data-appearance=large]` |
| Thread composer row | attach 28, pills 32, send 36 | all 32 | session-ui `prompt-input/index.tsx` attach trigger (`size="large"` = 28) and send `size-9` |
| Settings › Skills search | 28px (no `.settings-v2-tab-search`) | 36px like Models and Servers | `skills.tsx` |
| Create project | name 280px, outcome default width, location 640×36 | all full width; single-line fields 36 | `project-details.tsx`; TextInputV2 default `width: 280px` |
| Markdown bold | 500 against 450 body | 600 | `session-ui/src/components/markdown.css` `strong, b` |

Out of scope, moved: nested radii (needs per-surface review of parent insets; goes with PR4 page frame);
collapsing the stacked M3 overrides in `button-v2.css`/`text-input-v2.css` (refactor with no visual change);
a lint for raw `text-[Npx]`. Button `small` (24px) stays for dense icon rows.

## Parts

| ID | Outcome | Criteria | Files |
|---|---|---|---|
| P1 | Control tokens; large field and large button use `--v2-control-md` | AC-1, AC-2 | `ui/src/v2/styles/theme.css`, `text-input-v2.css`, `button-v2.css` |
| P2 | Composer row 32px | AC-3 | `session-ui/src/v2/components/prompt-input/index.tsx` |
| P3 | Skills search and create-project fields | AC-4, AC-5 | `skills.tsx`, `project-details.tsx` |
| P4 | Markdown strong 600 | AC-6 | `markdown.css` |

Tests: `acceptance/uiux-pr2-size.test.ts` (copy of `app/src/uiux-pr2-size.test.ts`); `verification/live.mts`.

## Completion evidence

Baseline: 6/6 acceptance fail; live V1 tokens empty, V3 attach 28 / send 36 / mode 32, V4 search 28.

Test change after the freeze: AC-6 anchored on `"  strong,\n  b {"`, but `markdown.css` is checked out with CRLF on
Windows, so the slice never matched. Replaced with a line-ending-agnostic regex; the assertion (strong/b weight 600)
is unchanged. AC-3's slice stopped at the icon's `/>`; the attach button's `class` was moved before `icon` instead.

Test change after the freeze: AC-6 anchored on `"  strong,\n  b {"`, but `markdown.css` is checked out with CRLF on
Windows, so the slice never matched. Replaced with a line-ending-agnostic regex; the assertion (strong/b weight 600)
is unchanged. AC-3's slice stopped at the icon's `/>`; the attach button's `class` was moved before `icon` instead.
