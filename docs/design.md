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

- **Frame: two shells.** The title bar belongs to the window: it has no
  background, and nothing runs up behind it or crosses it. Every surface
  starts 8px below it (`titlebar-inset-top`, `titlebar-inset-margin`), so all
  top edges line up, with 8px to the window's other edges and between
  surfaces. Each surface is a 16px card on `bg-base` with a hairline ring
  (`0 0 0 1px` `border-muted`): the left shell, the page (or thread) and, in
  a thread, the right shell.
- **Page:** every page sits on one such card built from
  `components/page.tsx` (`PageFrame`, `PageHeader`, `PageSection`,
  `PageEmpty`; `pagePanelClass` for pages with their own layout): Home,
  Projects, Calendar, Command Centre, the new thread and the thread itself.
- **Left shell:** the navigation rail and the Projects panel are one card
  that clips them. The rail is a 64px tinted strip (`bg-layer-01`) with a
  hairline on its right while the panel shows; the Projects panel keeps
  `bg-base` and has no ring of its own. Closed, the shell is the rail alone.
  The rail's destinations are 44px icon boxes (12px corners, 20px icons, 6px
  apart): hover is `overlay-hover`, where you are is the accent container, and
  each has a tooltip with its name. Settings sits at the rail's foot. Add
  project and Scan sit in one bordered button group in the panel's header
  (10px corners, `bg-layer-01`, a hairline between the 32×30 buttons).
- **Right shell (thread):** the side panel and the thread's rail are one
  card, mirroring the left: the panel on `bg-base` with the card's left
  corners, the 48px rail strip (`bg-layer-01`) against it with the right
  corners and a hairline on its left. With the side panel closed the rail
  alone is the card. The rail's buttons are 36px (10px corners, 6px apart;
  hover `overlay-hover`, the open section the accent container), with badges
  at each button's top right; Documents (the thread's written and linked
  documents, each opening in the Files viewer) follows Files; Context (the
  usage ring) is the last section,
  after Canvas, which is always there (it opens on the canvas's empty state
  before the agent has drawn). The Terminal button sits apart at the rail's
  foot, outside the section tabs (it toggles the panel below the thread, as
  the header button and Ctrl+` do), in the accent container while open. Review and the terminal stacked in the panel are split by a
  hairline, and the panel's resize handle sits on its left edge. Rounded
  corners otherwise are for things inside or above the page (cards, docks,
  menus, floating windows).
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
- **Projects page: list and detail.** The page's column is 1200px wide
  (`PageHeader column="split"`). Under the header (title, New page, New
  Project), two cards 12px apart fill the page and scroll inside themselves,
  both `bg-layer-01` with 16px corners and an inset muted hairline. The list
  card (300px, 8px padding) holds the search box (10px corners), All
  projects, one row per Project (name, its % on the right and a 4px bar
  under it; 10px corners, 2px apart), the folded Archived and the General
  pages. The selected Project has an accent-container pill that slides
  between rows (`--v2-duration-medium`, emphasized-decelerate; no slide
  under reduced motion). The detail card (22px padding) shows the Project's
  name (20px semibold) and outcome with its ··· menu and Start work; its
  status chip, "60% · 6 of 10 tasks" and Open project; a 4px bar; one row
  (wrapping only when it must) with "Next milestone: … · due …", the blocker
  callout (10px corners, `bg-layer-02`, warning icon) and, on the right,
  "N pages · N threads · updated …" on one line; then its open tasks (up to
  five) as the Project page's own task rows in a full-width `bg-base` card.
  A new selection fades in (`ViewSwitch`). Below 1024px the list card is
  alone and a row opens its Project.
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
  Running section becomes "Subagents · N running · M done" listing only the
  subagents still at work (breathing dot, small bar, chevron; "None running
  now" when all have finished), then **All subagents**. A row or that link
  opens the side panel's Agents tab and closes the window. Its Connectors
  section starts collapsed to "Connectors · N on" with a chevron; open, it
  lists each server on or off and ends with Manage MCP servers. The choice is
  remembered.
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
- **Progress and usage:** `Meter`. Spinner: `LoaderV2` (loading, not a running
  agent). Running: the blue dot that breathes in and out, `.running-pulse`
  (2 s ease-in-out, scale 0.8–1 and a soft halo). Under reduced motion it is a
  steady blue dot; its label still says Running.
  It marks a running thread in the sidebar, Home and the Command Centre, the
  thread's Working row and each running step or subagent.
- **Finished threads** (sidebar, until opened): a muted check for Done, the
  accent reply icon for Needs your reply (the agent's last paragraph asks a
  question), and a critical warning for Failed.
- **Free-text answers in a choice card** (the question dock's "Other"): no ring
  on the text box itself; while it has focus the option's edge becomes a 1.5px
  line in the focus colour, and the caret does the rest.
- **Agent task list** (`session-todo-dock.tsx`, `SessionTodoTray`): part of
  the composer's tray, the layer-02 tab inset 18px that holds the folder and
  branch, never a card of its own. While an agent runs, the tray grows a 36px
  row above the where row: the run's mark (`LoaderV2` in accent, a check when
  done), the step in progress (weight 500), "N of M" and a chevron that points
  up while collapsed; a 2px accent line on the row's bottom edge fills as steps
  finish. Expanding unfolds the steps above the row inside the same tray; each
  step has a 16px mark, a filled check for done (text dimmed), `LoaderV2` for
  the step in progress (weight 500) and a dashed circle for steps to come.
  Status is carried by the mark's shape. The section opens and closes with the
  run (300 ms spring), clipped from the top so the row leads.
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
- **Dictation** (`dictation-button.tsx`): while recording, one row takes the
  composer toolbar's place at the toolbar's height, so the composer never
  grows: a small accent wave (14 bars, 56×16px) that follows the voice, the
  words heard so far in italic `text-muted` (they're still being transcribed;
  a long transcript clips at its start so the newest words stay in view), and
  a small contrast Stop. Escape throws the recording away. The final
  transcript goes in at the caret as ordinary text.
- **Computer use on screen** (`computer-indicator.ts`): while an agent acts on
  the desktop, a Tenon-blue (`--v2-blue-600`, `#3b5cf6`) glow frames the
  display (a 2px edge with a soft inner glow that breathes; steady under
  reduced motion) and lets every click through; the Stop pill sits above it
  at the bottom of the screen. Both go a few quiet seconds after the last
  action.
- **Command Centre hub** (`hub-view.tsx`): `/command` is a hub first and a
  chat second, so work can run on its own. A band (16px card) names the
  Command Centre's harness and model and what is running (agents in Projects,
  then "N tasks running outside a Project" for tasks it delegated without
  one); Needs you rows
  (layer-02, warning icon) answer permissions in place; then a card per
  Project (16px, layer-01, inset hairline; three columns from 1180px, two from
  760px): name (15px semibold) and outcome, the state on the right (warning
  chip for Needs you, the running dot for Running, muted text otherwise), the
  next milestone with % and a 4px bar, a stack of 24px harness-logo tiles
  (who is working; the Command Centre's first) with "N working · N needs
  you", and a hairline-topped last line: the newest running thread's logo,
  title and time. Cards enter with a 40ms stagger. A card opens the Project
  (Back in the page header): the Command Centre's card leads (its logo and
  model, its thread title, "Now:" its current step, its checklist as the
  plan), then a card per agent: the harness logo on a 28px tile, the model as
  the name and the harness under it, the thread title (two lines), the step
  "text · n of m" with the running dot (or warning, or a muted check and
  "Finished · time"), a 2px progress line, and the Command Centre's rail icon
  when it started that thread. The milestone and Activity sit in a 380px
  column on the right. An agent opens a 24px floating panel over that column
  (plan, latest reply, Open thread, Stop); Esc or Close dismisses it. Harness
  and model tell agents apart, never colour. Chat is the composer docked at
  the foot (the light composer's raised pill, 560px): focusing it opens a 24px
  floating sheet above it with the latest exchange and Open thread. Views
  fade through (`ViewSwitch`); panels and the sheet use `Presence`.
- **Command Centre threads** (`command-thread-chrome.tsx`): a Command Centre
  thread is the ordinary thread view, never a second chat UI. Its extras sit
  around it: the page's title, thread menu and views in the thread's header,
  the Mission board as a side panel, and each turn's actions as one
  Done-for-you list under the reply. The Ctrl+J card briefs before it
  converses: counts, then what needs you (answered in place), then what's
  running with its checklist step, then the latest exchange and composer.
- **Started by Command Centre:** a thread the Command Centre started (a task
  it delegated into a Project, or `thread_start`) shows the Command Centre's
  rail icon (`console`, muted, small) in its sidebar row before the status
  mark, with the tooltip and label "Started by Command Centre".
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
  being written. The frame scrolls with the app's overlay pill scrollbar
  (`design-fence.ts` adds it ahead of the design's own styles, in neutral grey
  since the frame can't read the theme). The header shows the title, a "Drawing" chip with the
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

## Sound

Notification sounds are calm and short, like the motion. Tenon's own come from
`tenon/packages/ui/script/sounds.ts`; change them there and run
`bun script/sounds.ts` from `tenon/packages/ui` (needs ffmpeg) rather than
editing audio files.

- Three families (Glass, the default, Soft and Pulse), each with the same three
  phrases: **done** rises, **needs you** taps twice on one note, **error**
  falls. Error sits lowest and needs-you brightest, so they are told apart
  without looking.
- Under 0.8 s, a soft attack (no click), a fade to silence, and one peak level
  (-9 dBFS) across the set.
- "Done" is off by default because it fires often; needs-you and error are on.

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
