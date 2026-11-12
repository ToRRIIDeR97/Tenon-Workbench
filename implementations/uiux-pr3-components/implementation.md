# UI/UX PR3: shared recipes

Source: UI/UX review board, Design 2. Branch `claude/uiux-pr3-components`, stacked on PR2 (`707b5c9f`).
One agent (TOR-1) wrote plan, tests and code.

## Feature map

| Trigger | Baseline | Expected | Causal path |
|---|---|---|---|
| An agent asks a question | 12px raised shell plus a separate bordered tray for the footer, 36px buttons | the approval card's shell: 24px radius, base fill, 1px muted ring, one surface, 28px buttons | `DockPrompt` (`DockShell` + `DockTray`) styled by `message-part.css` `[data-kind=question]`; `session-question-dock.tsx` `size="large"` |
| Approval card Deny / Allow once | two pills 1px apart with 4px inner corners; ring around one half | one clipped pill with a divider; inset ring per half | `SplitButton` in `session-permission-dock.tsx` |
| Deny with a reason | 36px field, 12px radius, beside 28px pills | 28px pill field | same file |
| Home | two progress-bar recipes (h-1.5 layer-02 icon-accent vs h-1 layer-03 bg-accent) | one `Meter` | `brain-home.tsx` |
| A page's boolean property (routine enabled) | checkbox, while Settings uses switches | small switch | `notes-page.tsx` |
| Settings › Models and Skills lists | 52×32 switches in dense rows | small 44×26 | `models.tsx`, `skills.tsx` |

Deferred: one list-row recipe across the plus, mode, model, `/` and `@` menus (wide refactor of the session-ui
prompt-input popovers; separate PR).

## Parts

| ID | Outcome | Criteria | Files |
|---|---|---|---|
| P1 | Question dock on the card shell | AC-1 | `session-ui/src/components/message-part.css`, `session-question-dock.tsx` |
| P2 | Split button pill, deny-reason pill | AC-2, AC-3 | `session-permission-dock.tsx` |
| P3 | Shared meter on Home | AC-4 | `components/meter.tsx` (new), `brain-home.tsx` |
| P4 | Switches for booleans; small in lists | AC-5, AC-6 | `notes-page.tsx`, `models.tsx`, `skills.tsx` |

Tests: `acceptance/uiux-pr3-components.test.ts`; `verification/live.mts` (mounts the real approval card).

## Completion evidence

Baseline: 6/6 acceptance fail. Live: both split wrappers radius 0, overflow visible, 1px gap; chevron ring offset +2px.

After: 6/6 acceptance pass (tests unchanged since the freeze). Live: both split wrappers are a clipped pill
(`overflow: hidden`, full radius) with 0px between halves; chevron ring `solid`, offset −2px. App unit tests 1090 pass.
Not verified live: the question dock (needs a pending question; the component needs session contexts to mount).
