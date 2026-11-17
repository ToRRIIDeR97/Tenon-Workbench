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
  `--v2-state-fg-warning`), used for things that need the user; diff tints
  for added and removed lines in tracked edits are the other (below).
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

- **Page frame:** every page sits on one square-cornered panel built from
  `components/page.tsx` (`PageFrame`, `PageHeader`, `PageSection`,
  `PageEmpty`): `bg-base` with a hairline edge, 8px in from the window's right
  and bottom. On a desktop-width window it reaches the window's top edge: the
  title bar has no background and floats over the panel's top band
  (`page-panel-cap`), a hairline separates that band from the page, and page
  content starts below it (`titlebar-inset-top`).
- **Sidebar: two surfaces.** The navigation rail is a rounded card: 64px wide,
  16px corners, `bg-layer-01` with an inset muted hairline, 8px in from the
  window. Its destinations are 44px icon boxes (12px corners, 20px icons, 6px
  apart): hover is `overlay-hover`, where you are is the accent container, and
  each has a tooltip with its name. Settings sits at the rail's foot. 8px
  beside the rail, the Projects panel is a page-style panel (`bg-base`, a
  hairline edge, square corners); the two never touch. Add project and Scan
  sit in one bordered button group in the panel's header (10px corners,
  `bg-layer-01`, a hairline between the 32×30 buttons).
- **Thread side rail:** the same rail spec on the right: a 48px card (16px
  corners, `bg-layer-01`, inset hairline) with 36px buttons (10px corners,
  6px apart; hover `overlay-hover`, the open section the accent container),
  badges at each button's top right. Context (the usage ring) is the last
  button in the list, after Canvas. In a thread, the side panel joins the
  thread as one card, split by a hairline. Rounded corners are otherwise for
  things inside or above the page (cards, docks, menus, floating windows), not
  for the page frame.
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
  and remembers only that the user closed it (it starts open). It floats over
  the content beside it, which never moves for it; when it would cover the
  thread's text column, the window minimizes to its toggle and returns once the
  column is clear of it. Use a popover instead for anything that should close when you click
  away.
- **Thread column:** the timeline's turns and agent-write cards share one
  centered column, 640px wide by default; the composer sits in it at most
  560px wide. Settings → Appearance →
  Thread width sets it to Narrow (640px), Medium (800px), Wide (960px) or Full
  (the whole thread panel) through `--tenon-thread-width`. Thread text (replies and the
  user's messages) and the composer's text are 15px on 24px lines, a step above
  the app's 14px base; reply headings are 18/16/15px.
- **Wide windows:** lists and single columns keep a reading width when the
  window is stretched (pages 720/1040px, the thread 640px unless Thread width changes it). The calendar's
  Day grid caps at 880px and its Agenda and Tasks lists at 760px, centred;
  Week and Month use the full width because their columns are the content.
- **Harness logos:** every harness shows its logo at 16px to the left of its
  name: the Tenon mark for the built-in agent, its maker's logo for Codex
  (OpenAI), Claude Code (Anthropic) and OpenCode, its own mark for Antigravity
  and Command Code (`app/src/assets/harness-logos/`), and a letter tile for any
  other agent (`harness-logo.ts`). The model pill shows the logo of the
  harness that runs the model, not the model's maker, and Home's plan-usage
  rows lead with it too.
- **Projects page:** on a wide window, a 300px list beside a preview of the
  selected Project (progress ring, next-milestone card, open tasks, recent
  threads and pages, Start work and Open project). The selection is an
  accent-container highlight that slides between rows; the preview rises in.
- **MCP servers:** built from the standard Settings parts only: an Installed
  section (settings card of rows: name, "Local · command" or "Remote · URL",
  switch), then a Suggested section of rows with an Add button. Adding flies the
  suggested row into the Installed card. Custom server opens the form.
- **Model profiles:** folding rows like Harnesses (chevron, model id, rule
  count, switch). An open profile has the Built-in harness segmented control:
  Rules lists each rule as a settings row with a remove button and an "Add a
  rule" field; profile.md edits the Markdown. Add profile in the header opens
  a search over your models (rows with Add; a typed id that matches none can
  still be added); Delete and Build with an agent sit under the open profile.
- **Subagent context:** in a thread with subagents, the Context tab's
  Subagents cards replace "Taking the most room": per subagent its own context
  (used of its window, or "≈N estimated" from its transcript when the agent
  reports none, as OpenCode does), agent, turn and how it ended; a card opens
  its usage with Open in Agents and Show in thread. The Environment window's
  Running section becomes "Subagents · N done" with a row and small bar each.
- **Composer: light tab** (`session-ui` `prompt-input`, both the thread and
  the new-thread composer). At most 560px wide, centred in its column (the
  docks that attach to it share that width); empty, it is about 130px tall.
  The box is one raised surface (`bg-raised`, 28px corners) holding the
  attachments, the prompt (at least 52px, text 12px from the top) and the
  controls row, with a 1px `border-base` ring and the soft drop shadow at
  rest and the focus ring while focus is inside it. The where row (folder ›
  branch) is a tab above the box: 18px in from the box's sides, 18px top
  corners and a square bottom, `bg-layer-02` (lighter than the box and the
  page in dark, a step darker than both in light) with an inset muted
  hairline. It shows 34px above the box and tucks 12px behind its top edge;
  the box sits in front with its corners whole. No where row, no tab.
- **Composer row:** the 44px controls row has no fill or border of its own;
  its controls ghost as elsewhere at 30px (Send is 30px too), and it ends
  with the context ring. There is no Tasks button: running subagents show on the
  thread rail's Agents button, as a count badge.
- **Model pill** (`model-pill.tsx`): leads with the logo of the harness that
  runs the model (the Tenon mark for the built-in loop), never the model
  maker's. When the model offers reasoning levels the pill always shows one,
  "Model · Level": the chosen level, or on default the level the harness says
  default means (Codex reports it; the list then reads "Default (low)"), else
  "Default". It is then two targets in
  one pill, split by a faint divider, each with its own hover, focus ring and
  name ("Model: …", "Reasoning: …"): the logo and model open the full
  harness/model/reasoning/speed stack, the level opens just the reasoning
  list, where a pick applies and closes. Speed shows after the model only
  when it isn't the default. Without reasoning levels the pill is one target.
- **Composer text:** the placeholder is 13px regular (400) in both themes;
  typed text stays 15px. In dark mode the composer's muted and faint greys
  are `#f2f2f2` and `#d2d2d2`, for legibility on the dark surface. Light mode
  keeps the theme greys.
- **Instructions (harness sync):** a status row (headline, detail, Sync now),
  then Sync across computers as settings rows, the shared text in a monospace
  textarea, and one folding row per harness (chevron, logo, name, file path,
  mode pill) that opens to the mode segmented control, the extra or own text
  and a preview of the file. Changed-outside states use the warning text
  colour on a layer-02 fill, never a yellow fill. A save bar at the bottom says
  whether changes are unsaved and offers Discard and Save to all computers.
  Settings › Skills opens with the same sync part: shared skills, a mode per
  harness with an extras checklist, and Share for skills found locally.
- **Settings pages:** new Settings content uses the existing parts (tab header,
  `settings-v2-section` with its title, `settings-v2-list` cards of
  `settings-v2-row`s, the Harnesses folding group, the Built-in harness
  segmented control). No nested panes, custom cards or tiles inside Settings.
- **Exits:** anything that animates in also animates out. The Reply pill fades
  where it was (except when it grows into the reply card), and hand-rolled
  popups such as the folder picker's suggestions use the menu exit.
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
  into a 400px floating card (radius 20px, floating elevation, ~74px tall):
  the pill's own "↩ Reply" label, one faint truncated line of the passage and
  Close on top; the text box with the mic and Send on the line below. The
  placeholder names the keys: Enter adds the reply to the composer as a
  two-line chip, Ctrl/⌘+Enter sends it now. The card opens from the pill's
  corner (upward from a pill above the selection, so the passage stays in
  view), keeps the Reply label in place while the surface stretches, flies
  into the composer when added, and shrinks back into the pill on Escape; a
  click outside closes it only while empty. A sent reply puts each passage and
  its answer in an inset box (layer-02 on the layer-01 bubble; layer-03 on
  layer-02 in light) inside the user's bubble.
- **Links in the composer** (`link-highlight.ts`): accent text, underlined,
  drawn with the CSS Highlight API so the editor's text is untouched. A plain
  click edits; Ctrl/⌘-click opens the link.
- **Switches in lists** use the small size.
- **Canvas follows the agent** (`canvas-tab.tsx`, `live-design-frame.tsx`):
  when a canvas design starts drawing in the open thread, the side panel opens
  on Canvas with it large, once per design, at its first visible element; a
  design the user closed or left for the list stays closed, and history never
  opens the panel. The page draws in place, element by element: new elements
  fade in over `--v2-duration-medium` with the emphasized-decelerate easing
  (none under reduced motion) and a soft accent outline marks the element
  being written. The header shows the title, a "Drawing" chip with the
  running dot (it settles to "Drawn just now") and a Preview / Code segmented
  switch; Code shows the source so far with an accent caret, kept scrolled to
  the end. "Use this one" appears once the design is done.
- **Live document** (`live-document-view.tsx`, `file-viewer.tsx`): when the
  agent starts writing or editing a text file in the open thread, the side
  panel opens on Files with that file, once per call (never for history, and
  not again after the user closed the panel or moved on). The header shows a
  "Tenon is writing" chip with the running dot beside Rendered / Source; it
  settles to "Saved just now". Rendered text grows with an accent caret and a
  shimmer line after the last block; a floating "Following Tenon" pill keeps
  the end in view and turns into "Jump to Tenon" once the reader scrolls.
  When an edit finishes, the changed blocks flash once (accent container
  fading out over 1.6 s, none under reduced motion) while the block the reader
  is on stays where it is. `.html` writes go to the Canvas instead.
- **Tracked edits** (`tracked-source.tsx`): in Source, the agent's unreviewed
  changes to a file show inline with line numbers: removed lines struck
  through and muted on the danger tint (`--v2-state-bg-danger`), added lines
  on the success tint (`--v2-state-bg-success`) with a 2px success bar on the
  left. These diff tints are the one other exception to "no colour coding",
  and only for added and removed text. While an edit streams the change grows
  live without controls; when it finishes, a row of small pills (outlined
  Keep, text Undo) sits under each change, never over its text, and a sticky
  header reads "N edits by Tenon" with Undo all and Keep all. Keep fades the
  tints out over `--v2-duration-medium` (instantly under reduced motion). A conflict shows a
  warning banner, "This file changed since Tenon's edit", with Reload and
  Override.
- **Canvas board** (`design-board.tsx`, `board-camera.ts`): the Canvas list
  is a pan/zoom board. Designs are 1280×800 artboards (white, hairline edge)
  on a dotted layer-01 surface (dots from the muted border token, 12px
  radius, inset hairline), in as many columns as show them largest (a tall
  side panel stacks them in one). Each has a screen-size label above it:
  "A · Title" and a status ("Drawing…", or "Done" with "Use this one"). The
  title keeps its full width: "Use this one" joins only when it fits beside
  it, then "Done" (both are in the large view too). The board being drawn
  has an accent outline. A zoom pill in the header (− NN% +, the % fits all
  designs and announces the zoom) zooms around the centre; wheel or pinch zooms at the pointer, a
  drag pans, and the focused board takes +/− (zoom), arrows (pan) and 0 (fit
  all). While a design draws the camera glides to its board
  (`--v2-duration-long`, emphasized-decelerate); when nothing draws it shows
  all boards. Once the user pans or zooms it stays put until the next design
  starts. Under reduced motion the camera jumps. Clicking a board opens it
  large. Someone already on the board stays there when a new design starts
  or arrives finished: the camera follows it instead of opening it large.

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
- JS that waits out a CSS animation reads the duration with `motionDuration`
  (`@tenon/ui/v2/motion`), which understands both `200ms` and the minified
  `.2s`; never `parseFloat` a duration token yourself.

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
