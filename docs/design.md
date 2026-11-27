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

## Icons

One pack, `tenon/packages/ui/src/v2/components/icon-pack.ts`, draws every
glyph for both `Icon` components (`@tenon/ui/v2/icon` and `@tenon/ui/icon`);
only the GitHub, Discord and MCP brand marks keep their own artwork.

- 16-unit grid, live area 2–14, outline only: 1.25px stroke (kept at 1.25px
  at every size), round caps and joins, 1.5–2 unit corners on boxes. Solid
  fills are for dots and the stop square; "active" variants add an 18% tint.
- One concept, one glyph: Command Centre is the target (`command-centre`),
  Terminal the framed prompt (`terminal`), a shell command the bare prompt
  (`console`), Harnesses the agent head (`harness`), MCP the plug (`plug`),
  Skills the sparkle wand (`skills`), Mail the envelope, Model profiles the
  card (`model-profile`), harness sync the two arrows (`sync`), thread sync
  the cloud with an arrow (`cloud-upload`). Don't reuse a
  glyph for a different destination; add one to the pack instead.
- An unknown name renders as a plus, so add the glyph before using its name.

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
  Projects, Calendar, Command Centre, Usage, the new thread and the thread itself.
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
  documents, each opening in the Files viewer) follows Files; Background tasks
  (below) follows Documents, its badge counting what is running; Context (the
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
- **Projects page: covers.** The page's column is 1200px wide
  (`PageHeader column="split"`) and scrolls as one page, with no inner
  cards. Under the header (title, New page, New Project) sit the search box
  (360px, 10px corners), then Projects: a count, All projects on the right,
  and a grid of Projects by their covers (one column, two from a 620px page,
  three from 960px; 24px across, 28px down). Each Project is its 132px cover
  band (the image, or the joinery pattern) with the name, any Paused or
  Archived word, the outcome, a 4px bar with its %, and a set next milestone
  written under it; there is no box around the text. Hover tints the whole
  item (`overlay-hover`, 18px corners) and grows the cover to 1.015; items
  enter with a 40ms stagger. A last item, an empty hairline-ringed cover with
  +, starts a New Project. Archived folds open (`Reveal`) into the same
  grid; General pages are rows under it (720px). Search swaps the grid for
  result rows. Opening a Project grows its cover into the Project page's
  cover band (a view transition named `project-cover`,
  `--v2-duration-long`, emphasized-decelerate; the rest of the page
  cross-fades over `--v2-duration-medium`), and Back plays it in reverse;
  under reduced motion, or if the transition can't start within 250ms, the
  page simply changes.
- **Usage page: a dashboard when wide.** Up to 1400px of page it keeps the
  1040px column: the total, its make-up and the day chart span it, with the
  harness table and heaviest threads side by side once the page is 900px
  wide. From 1400px (a container query, so an open sidebar counts) the column
  fills the page: the total, chart (192px tall) and harness table stack on
  the left, and the heaviest threads (up to 12) take their own column on the
  right (`PageHeader` `column="dashboard"`, `pageDashboardColumnClass`).
- **Project page: one column, a dashboard when wide.** Once the page itself
  is 1400px wide it becomes a dashboard, like a wide notes page: the cover
  runs edge to edge across the page (200px, square, a bottom hairline), the
  title, road and numbers span the page, and below them Pages and Settings sit
  in a 360px column on the left with Tasks and Story in the wide column beside
  them; the section index steps aside, since everything is in view. Narrower,
  it is one column that grows with the page up to
  1100px (so a wide window isn't mostly margin; long log lines stop at 80ch);
  once the page itself is 960px wide (a container query, so an open sidebar
  counts), a 120px section
  index sits beside it (pills: hover `overlay-hover`, the section in view
  `overlay-pressed`, the last section once the page's end is in view; it
  sticks while the page scrolls). The column opens on a 132px cover band (20px
  corners, `bg-layer-01`, hairline; the Project's cover image, cropped to
  fill, or else a joinery pattern in `border-muted` fading to the right). On
  the band, Back (a neutral icon button, top left) returns to Projects and a
  small neutral Cover button (top right) opens Add, Change or Remove cover
  image; both sit on `bg-base` with a hairline ring so they read over any
  image. Below it comes the Project's 64px tile (its first letter in
  `type-display` on the accent container, 18px corners) overlapping its bottom
  edge and ringed in `bg-base`. Then the title row, the outcome, a set blocker
  as the warning chip, and the milestone road: a 2px `bg-layer-03` line from a
  small accent start dot, with the accent fill (a `scaleX` transform,
  `--v2-duration-long`, emphasized-decelerate, drawing in on open) through
  finished milestones and on toward the current one by its share of tasks
  done. Done stops are filled with the accent, the current stop is an accent
  ring (`aria-current="step"`), later stops are hollow (`border-strong`), with
  titles and dates under them (a done stop's date reads "Done · planned …",
  since no completion date is stored). The first, last and current stops always keep
  labels; the others show once the road is 480px wide (past five milestones,
  only next to the current one), and hidden labels stay readable to screen
  readers. No milestones shows a dashed road with a Milestone button; while
  the timeline loads the road's height is held. The numbers row is one 16px
  card of four cells split by hairlines, two by two below 480px
  (`type-display` numbers that count up over `--v2-duration-long`, captions
  under them; the agents cell breathes while any run; the task cells show a dash,
  read as "Not loaded", until the timeline loads or when it fails, and the road
  is left out when the timeline fails). Sections follow 40px
  apart, each a 13px semibold title with a small `type-caption` count pill
  (`bg-layer-02`). Story hangs threads and log entries from a 2px
  `border-muted` spine as 28px `bg-layer-02` nodes with an icon (terminal for
  a thread, pencil for a log entry), each day its own list under a heading; a
  running thread is semibold with the breathing dot, the next milestone sits
  at the top as a hollow ◆ node, and only entries that arrive after the page
  opened slide in. Threads show while the log loads; a failed log is one
  critical line with Try again at the end. Under reduced motion the fill and
  numbers show their end state at once.
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
  its usage with Open in Agents (the Background tasks section) and Show in thread. The Environment window's
  Running section becomes "Subagents · N running · M done" listing only the
  subagents still at work (breathing dot, small bar, chevron; "None running
  now" when all have finished), then **All subagents**. A row or that link
  opens the side panel's Background tasks section and closes the window. Its Connectors
  section starts collapsed to "Connectors · N on" with a chevron; open, it
  lists each server on or off and ends with Manage MCP servers. The choice is
  remembered.
- **Background tasks** (`background-tasks-tab.tsx`, the side panel section that
  was Agents): one list of the thread's subagent runs and shell commands, including the
  long-running ones an agent starts in a terminal tab (`terminal_start`). On
  top, All / Agents / Commands filter pills with counts (the accent container
  marks the chosen one). Then **Running** (newest first; "Nothing running in
  the background." when empty) and **Finished** (latest ended first), each a
  caption with its count over one 16px layer-01 card of rows. A row has the
  kind's step icon (subagent or shell prompt), the title (a command in
  monospace), while running the breathing dot and the elapsed time, and a
  12px status line: the subagent's current step or the command's last output
  line, then "Done · 48s · exit 0", "Failed · …" (critical text) or
  "Stopped · …". Kinds differ by icon and typeface, never colour. A running
  row ends with a Stop icon button. A row opens its detail (`ViewSwitch`) with
  a Background tasks back link: a command shows its output in a monospace
  layer-01 box that follows the end while it runs, with Copy output and Stop;
  a subagent shows its prompt, steps and result. Stop is honest about its
  reach: a built-in subagent whose own session has started stops alone ("Stop"), and
  so does a command in a terminal tab (Stop closes that terminal; its detail
  says the output is in the terminal and offers Show terminal); any other
  command, or an external harness's subagent, can only end the whole turn, so
  the button reads "Stop turn". New rows enter with the standard enter motion.
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
  thread rail's Background tasks button, as a count badge (with running commands).
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
- **QR codes** (Settings › Servers › Phone access): dark modules
  (`--v2-grey-1000`) on a light tile (`--v2-grey-50`) with a four-module quiet
  zone and 8px corners in both themes, so a phone camera reads them; 168px
  square beside the code written out in groups of four.
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
- **Dictation** (`dictation-button.tsx`, `dictation-ghost.ts`,
  `dictation.css`): the composer's toolbar never changes while recording; the
  mic stays pressed and its tooltip says Stop. A small contrast capsule
  (`bg-contrast`, 36px pill) springs up out of the middle of the composer
  box's top edge (`--v2-duration-medium`, spring) with the time (`m:ss`), a
  7-bar meter that follows the voice (loudest in the middle), the language it
  transcribes in ("Detect language" when the model detects it) and a round
  Stop. The words heard so far appear in the composer itself, at the caret, in
  italic `text-faint` with a blinking accent caret after them (each word fades
  in); a copy of the editor holds them, so the draft isn't touched until the
  end. On Stop the capsule swaps to a spinner and "Finishing…"; when the final
  pass lands it drops back in (`--v2-duration-exit`) and the words firm up
  from left to right to ordinary text over `--v2-duration-long` before going in
  as typed text. Under reduced motion every step shows at once. Escape throws
  the recording away. When the final text differs from the words shown, a
  toast says how many words changed with "Use what I saw". The compact
  composer has no room and keeps a floating caption above the mic.
- **Computer use on screen** (`computer-indicator.ts`): while an agent acts on
  the desktop, a Tenon-blue (`--v2-blue-600`, `#3b5cf6`) glow frames the
  display (a 2px edge with a soft inner glow that breathes; steady under
  reduced motion) and lets every click through; the Stop pill sits above it
  at the bottom of the screen. Both go a few quiet seconds after the last
  action.
- **Command Centre workflows** (`workflows-view.tsx`): the editor reads as
  text, not a form. The workflow's name (15px semibold) and description
  (12px muted) edit in place with no field border (hover overlay, focus ring).
  The roles are one list surface (16px, `bg-base`, inset hairline, hairlines
  between rows, like a Settings list): each row has a number, the name (edited
  in place), the may chip, the harness and model chips on the right and the
  job on one muted line; its chevron unfolds it (`Reveal`, even), one role at
  a time, to a borderless job box on layer-01, the may line and Delete. A new
  role opens unfolded. **Run settings** is one row of limit pills (label, then
  a small number field). The run is docked under the setup, outside its
  scroll: the missing items as a wrapping list of hollow circles (muted, then
  critical after a refused Start), and a composer box (20px, raised) with the
  brief, the Project chip and a contrast Start. Below 900px the list and editor
  stack and the page scrolls, with the editor at least 600px tall.
- **Command Centre hub** (`hub-view.tsx`): `/command` is a hub first and a
  chat second, so work can run on its own, and it leads with work in
  progress. A line with no card names the Command Centre's harness and model
  and what is running (agents in Projects, then "N tasks running outside a
  Project" for tasks it delegated without one); Needs you rows (layer-02,
  warning icon) answer permissions in place; then **At work**, one row per
  agent running or waiting across Projects (waiting first, newest first):
  the harness logo on a 28px tile, the harness name, model and Project, the
  thread title, and on the right (from 760px) the step "text · n of m" with
  the running dot, or the warning and Needs you, over a 2px progress line; a
  row opens its thread. **Projects** follow as one row each, split by
  hairlines with no card: name and outcome, then (from 760px) the next
  milestone when one is set, the stack of 24px harness-logo tiles (who is
  working; the Command Centre's first), the state (warning chip, running dot
  or muted text) and the %. Rows enter with a 40ms stagger. A row opens the Project
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
- The one text animation: the Project page's numbers count up over
  `--v2-duration-long` (JS, `motionDuration`); nothing else animates text.
- JS that waits out a CSS animation reads the duration with `motionDuration`
  (`@tenon/ui/v2/motion`), which understands both `200ms` and the minified
  `.2s`; never `parseFloat` a duration token yourself.

## Sound

Notification sounds are calm and short, like the motion. Tenon's own come from
`tenon/packages/ui/script/sounds.ts`; change them there and run
`bun script/sounds.ts` from `tenon/packages/ui` (needs ffmpeg) rather than
editing audio files.

- Three families (Soft, the default, Glass and Pulse), each with the same three
  phrases: **done** rises, **needs you** taps twice on one note, **error**
  falls. Error sits lowest and needs-you brightest, so they are told apart
  without looking.
- Under 0.8 s, a soft attack (no click), a fade to silence, and one peak level
  (-9 dBFS) across the set.
- "Done" is off by default because it fires often; needs-you and error are on.
- A profile from before the Soft set moves each sound still on the earlier
  Tenon default to Soft, once (`migrateSounds` in `context/settings.tsx`);
  sounds the user picked are kept.

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
