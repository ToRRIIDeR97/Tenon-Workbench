# Tenon Workbench design

The intended look and feel of the app. Read this before any UI change, and
update it in the same change when a rule here changes. The
[architecture README](architecture/README.md) ("Product entry points and
persistence") holds the implementation detail behind these rules.

## Principles

- **Calm and neutral.** Neutral greys carry the interface, with one accent
  (blue, `--v2-background-bg-accent`). No colour coding: status, harness,
  project and category are told apart by text, icons and position, not hue.
  The one exception is the warning state (`--v2-state-fill-warning`,
  `--v2-state-fg-warning`), used for things that need the user.
- **The thread comes first.** Chrome stays out of the reading area. Thread
  details (environment, context, connectors) open on demand from a toggle in
  the thread header or from the side panel; nothing floats over the timeline
  unless the user opened it.
- **One style, one job.** Each visual treatment means one thing (below);
  don't borrow a treatment for a different meaning.
- **Material 3 shape and motion**, through the `--v2-*` tokens only. No raw
  hex colours, pixel radii, durations or easings in components.

## Tokens

All tokens live in `tenon/packages/ui/src/v2/styles/theme.css` and
`tenon/packages/ui/src/theme/v2/mapping.ts`.

| Kind     | Tokens                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Radius   | `--v2-radius-sm` 8, `md` 12, `lg` 16, `xl` 24, `xxl` 28, `full` (pills)                                                                                 |
| Controls | `--v2-control-sm` 28, `md` 36, `lg` 44 (heights)                                                                                                        |
| Colour   | `bg-v2-*`, `text-v2-text-*`, `border-v2-border-*`, `bg-v2-overlay-simple-overlay-*`, `v2-icon-*`; the theme resets Tailwind's default palette          |
| Motion   | `--v2-duration-short` 150, `medium` 300, `long` 450, `exit` 200, `exit-small` 120, `swap-out` 100, `swap-in` 200; `--v2-ease-standard`, `-emphasized-decelerate`, `-emphasized-accelerate`, `-exit`, `-spring` |

## Type

Use the named roles in `tenon/packages/ui/src/styles/tailwind/utilities.css`,
never `text-xs`, `font-semibold` and similar (they emit nothing here):

- `type-display` (26px): pages you read (Notes, Project details).
- `type-page-title` (20px): other page titles. No descriptive subtitle.
- `type-toolbar-title` (15px): thread and panel titles.
- `type-section`, `type-row-title`, `type-body`, `type-body-compact` (13px).
- `type-control`: button and menu labels.
- `type-meta` (12px): helper and error text; `type-caption`: group labels.

Use `[font-weight:N]` when a weight must differ from the role.

## Surfaces and layout

- **Page frame:** every page sits on one rounded panel built from
  `components/page.tsx` (`PageFrame`, `PageHeader`, `PageSection`,
  `PageEmpty`).
- **Cards:** page-level cards are 16px radius on `bg-layer-01` with an inset
  muted edge. Use 12px cards inside the sidebar and side panels, and 24px for
  dock cards (the composer and approval dock).
- **Popovers and menus:** small surfaces open from the control that owns
  them (`Popover`, `MenuV2`), anchored `bottom-end` with a 6px gutter, at most
  `min(340px, 100vw - 32px)` wide, and scroll inside themselves. The composer's
  project picker is the wider exception (360px, 24px corners, 16px rows, group
  captions, a quiet detail such as the branch on the right).
- **Floating windows:** a panel the user keeps open while working (the
  thread Environment) floats below its toggle as one 24px card on
  `bg-floating` with a hairline edge and the floating elevation. Inside,
  sections are split by hairlines, each with a 13px semibold sentence-case
  title (no uppercase captions, no boxed groups), 12px rows and a label column.
  It has a close button in its title row, ignores outside clicks, closes on Esc
  and remembers whether it was open. It floats over the content beside it,
  which never moves for it; when the room beside it would leave that content
  too narrow to read (under 480px), the window minimizes to its toggle and
  returns when there is room again. Use a popover instead for anything that should close when you click
  away.
- **Desktop widget:** one card in a small frameless window on the OS desktop
  (nothing on Home): a 22px-radius card on `bg-floating` with a hairline
  edge, a draggable top bar with a mode chip (accent container when it shows
  Status or Command), Open in Tenon and Hide, the face, and Note · Status ·
  Command tabs. It shows whatever is newest and never switches while you type.
- **Thread header:** the title on the left; on the right, compact pill
  controls (28px), with the Environment toggle last, at the right edge. The
  thread's actions (rename, pin, fork, export, archive, delete) live in its
  sidebar row's menu, not the header.

## What each style means

- **Selected item in a list:** neutral fill (`overlay-pressed`, 8px corners,
  weight 600), shown and removed at once; selection never slides
  between rows.
- **Where you are / checked:** accent container (the navigation rail,
  today's date, checkboxes, checked menu items, toggles).
- **Primary action:** accent pill button. Other buttons are neutral pills;
  icon buttons are circular.
- **View switches and filters:** segmented look (`SegmentedControlV2`,
  `TabsV2` pill variant). Underlined tabs are for the sidebar's Group by only.
- **Progress and usage:** `Meter`. Spinner: `LoaderV2`. Running dot:
  `.running-pulse`.
- **Agent task list** (the dock on the composer, `session-todo-dock.tsx`):
  a "Tasks" title with "N of M" and a chevron; each step has a 16px mark, a
  filled check for done (text dimmed), `LoaderV2` in accent for the step in
  progress (weight 500), and a dashed circle for steps to come. Collapsed, the
  title row shows the current step. Status is carried by the mark's shape.
- **Reply to a passage** (`selection-reply.tsx`): the selection pill grows
  into a floating card (radius 18px, floating elevation) with "Replying to",
  the passage clamped to two lines on layer-01, the text box, the mic and
  Send. Enter sends, Escape closes; a click outside closes it only while empty.
- **Links in the composer** (`link-highlight.ts`): accent text, underlined,
  drawn with the CSS Highlight API so the editor's text is untouched. A plain
  click edits; Ctrl/⌘-click opens the link.
- **Switches in lists** use the small size.

## Motion

Every opening and closing surface animates, and animations match across the
app:

- **Entering:** `--v2-duration-medium` with `--v2-ease-emphasized-decelerate`
  for panels and pages. Small surfaces (popovers, menus, tooltips) scale from
  about 0.96 (menus 0.92) and fade in over `--v2-duration-short`.
- **Leaving:** about two thirds of the enter, on `--v2-ease-exit`:
  `--v2-duration-exit` for dialogs and toasts, `--v2-duration-exit-small` for
  menus, selects, popovers and tooltips.
- **State changes** (hover, colour): `--v2-duration-short`,
  `--v2-ease-standard`.
- **In-page:** use `Reveal` (expand/collapse), `Presence` (keep mounted
  through an exit) and `ViewSwitch` (fade between views) from
  `@tenon/ui/v2/*`. Don't hand-roll a show/hide without motion.
- Animate only transform, opacity and colour. The virtualized timeline
  expands and collapses instantly.
- Under `prefers-reduced-motion`, show the end state at once.

## Accessibility

- Text meets WCAG AA contrast in light and dark. Check both themes.
- Every control is reachable by keyboard, with a visible focus ring on
  `:focus-visible` only. A surface that opens moves focus inside it without
  ringing its first control.
- Icon-only buttons have an `aria-label` and a tooltip.

## Text

- UI text goes through i18n (`tenon/packages/app/src/i18n/en.ts`); new
  `secondBrain.*` keys may be English-only.
- Use sentence case, short labels and "Tenon" as the product name.
