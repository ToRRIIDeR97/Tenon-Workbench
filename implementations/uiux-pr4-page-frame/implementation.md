# UI/UX PR4: page frame and headings

Source: UI/UX review board, Design 3. Branch `claude/uiux-pr4-page-frame`, stacked on PR3 (`49ccc22b`).
One agent (TOR-1) wrote plan, tests and code.

## Feature map

| Trigger | Baseline | Expected | Causal path |
|---|---|---|---|
| Open a page with a centred content column (Projects, All projects, notes) | header spans the panel (`px-6`); content in a centred 720/1040 column, so title and content start on different edges (All projects: header 353, content 412) | header in the same column | `PageHeader` in `components/page.tsx` has no column option |
| All projects | project name and its sections (Upcoming, Recent notes) both 13/600 | project 15/600, sections 11/500 uppercase muted | `project-overview.tsx` h2/h3 |
| Settings sections | section title 13/600 with a 4px inset over 14/500 rows | 14/600 on the cards' edge | `.settings-v2-section-title` |
| Settings header | `padding: 40px 64px 32px 40px`; body `0 40px 40px`, so actions end 24px short | 40px both sides (close button sits above y=40) | `.settings-v2-tab-header` |
| Create project | 26px `type-display` heading | `type-page-title` like other pages | `project-details.tsx` |

Dropped after mapping: nested radii. The project rail cards sit in an unpadded column, not inside another rounded
card, so the reviewer's nesting case does not occur there; the other cited lines had moved.

## Parts

| ID | Outcome | Criteria | Files |
|---|---|---|---|
| P1 | `PageHeader column` and its use | AC-1 | `page.tsx`, `projects.tsx`, `project-overview.tsx`, `notes-page.tsx` |
| P2 | Heading levels | AC-2, AC-3, AC-5 | `project-overview.tsx`, `settings-v2.css`, `project-details.tsx` |
| P3 | Settings header edge | AC-4 | `settings-v2.css` |

Tests: `acceptance/uiux-pr4-page-frame.test.ts`; `verification/live.mts`.

## Completion evidence

Baseline: 6/6 acceptance fail. Live V1 header 353 vs content 412; V2 header right 1196 vs body right 1220.

After: 6/6 acceptance pass (only Prettier rewrapped two assertions after the freeze). Live: All projects header
372 + 40px padding = content 412; Settings header right 1220 = body right 1220. App unit tests 1096 pass.
Note: Vite's watcher on this OneDrive path missed the first edit and served a stale `page.tsx?t=`; touching the
files made it reload (no server restart).
