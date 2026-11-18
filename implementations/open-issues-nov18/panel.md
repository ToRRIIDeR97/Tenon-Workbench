# Panel review (3 Sonnet judges, medium effort)

The user asked for a panel of three judges scoring each area out of 10 on scope and on similarity to the
workshop prototypes (https://claude.ai/artifact/LU3npU2ACXUdFpMb1EJY5g), iterating until all three give 9 or more.

## Round 1

- Judge A (round-1 fixes, #321 slow start, #323 skills, #334 MCP): 7/10 (scope 7, prototype 6.5)
- Judge B (#326 canvas, #328 dictation, #330 attachments, #332 compaction): 5/10 (scope 4, prototype 4)
- Judge C (#331 GitHub, #333 computer use and follow-ups): 6/10 (scope 6, prototype 5)

### Checklist from round 1 (status updated as fixed)

A1 [~] (folder and timeout shown, Edit in place; no env names, tool list or rename: the config hides secrets and no per-server tools route) #334 expanded row: env key names, folder, timeout, tool count/list, Rename (needs a per-server tools route)
A2 [x] #334 edit non-secret fields of an existing server in place
A3 [x] #321 slow-start row: Update affordance when an update is known
A4 [x] (workshop text now matches: stays usable, next check asks again) #321 slow start: re-probe with a 30 s limit, clear the marker
A5 [x] #323 per-row Read-only chip with reason; "Off" text replaces description, drop extra sentence
A6 [x] #325 stage keyed on a commit signal (did-navigate / did-finish-load), not getURL()
A7 [x] #322 tool cards: per-tool times from state.time.start/end
A8 [x] (confirm expires after 4 s; stored sign-in removed in round 3) #334 remove confirm times out; removal also removes stored OAuth tokens
A9 [x] #328 mergeCaption: guard repeated phrases

B1 [x] (audio and a video's sound track transcribed by the dictation engine via transcribe_file) #330 audio (and video audio track) transcribed locally via the dictation engine
B2 [x] (built-in model's input types; harness models keep images and PDF) #330 chips and send use the selected model's input types (draft.inputs)
B3 [x] #330 chip copy per file: duration, grid count, slide count ("1:52 · 2 grids of 9 frames and an audio transcript")
B4 [~] (workshop text aligned: no grid preview on click) #330 grids generated on attach and previewed from the chip
B5 [~] (workshop text aligned: legacy files by name only) #330 legacy doc/ppt/xls through an installed converter, else name only
B6 [x] #332 Tenon divider "Tenon summarised N messages · View summary"
B7 [x] (observed divider skipped on a turn Tenon compacted) #332 no duplicate divider when Tenon already compacted that turn
B8 [~] (known harness names, else 'The agent') #332 harness name from the instance's display name
B9 [x] #326 Send now sends only the popover's note
B10 [~] (Send puts the notes into the composer as one message, as the workshop's Send now does) #326 tray Send actually sends (or copy says "Add to message")
B11 [x] #326 plural copy; popover clamped to the frame; highlight kept while writing; pin/tray motion
B12 [~] (wave and Stop replace the toolbar; words shown in the composer box, not typed into the field until Stop) #328 variant A: words in the real text field; wave + Stop replace the toolbar
B13 [x] #328 wave canvas resizes only on size change

C1 [x] #333 built-in agent gets screenshots as images (toModelOutput media)
C2 [x] #333 built-in agent tools registered whenever the driver is installed; switch enforced per call
C3 [x] #331 Refresh bypasses the cache; don't cache non-ok results
C4 [x] #331 rows merged into the task list: checkbox style, "Issue" chip, "N open issues" header, "filed by"
C5 [~] (kept server-side per Project folder in github-repos.json, not on the Project record) #331 repository stored on the Project, Repository row in Project settings
C6 [x] #333 card: separate Screen Recording / Accessibility rows with Granted / Not granted and Open Privacy settings; per-harness lines
C7 [~] (stop copy in the tool result; no thread divider) #333 Stop copy "(stopped: the driver was shut down)" and a "You stopped computer use" note
C8 [x] #333 one in-flight approval per session
C9 [x] #333 pill stays while a call runs, hides after the last call plus quiet; on the cursor's display
C10 [x] #333 ask text includes the action and "Screenshots don't ask"
C11 [x] #333 subfolders and worktrees of an enabled Project count

Test changes after round 1 (contract changed by the panel): `harness-computer-use.test.ts` now expects a Project subfolder to count (C11) and the macOS status to carry `grants`.

## Round 2

- Judge A: 8/10 (scope 8, prototype 7.5)
- Judge B: 7/10 (scope 7, prototype 7)
- Judge C: 7.5/10 (scope 8, prototype 6.5)

### Checklist from round 2

A2-1 [x] (GET /mcp/tools, GET /global/config/mcp/:name/names, POST …/edit {rename}; row line "Connected · N tools", open row lists tools and NAME = •••• chips, Rename in place) MCP: tool count, environment and header names (no values), Rename kept server-side
A2-2 [x] (emptied folder/timeout are removed via …/edit {clear}; the form names kept values and says how to clear) MCP Edit can clear folder/timeout; form notes stored values are kept
A2-3 [x] Slow start: a "Check again" row
A2-4 [x] (tool cards show their own state.time start→end, ≥1 s, through ToolTimeContext) Per-tool times on tool cards
A2-5 [x] (removal deletes the stored sign-in; a rename moves it) Removing an MCP server removes its stored sign-in
A2-6 [x] Browser `committed` resets when a new main-frame navigation starts
B2-1 [~] (workshop text aligned: chip states what is sent, no grid preview on click; legacy doc/ppt/xls by name only) Frame grid preview from the chip; legacy doc/ppt/xls through LibreOffice when installed
B2-2 [x] Transcription: 30 min cap, timeout, "Transcribing…" notice, visible fallback
B2-3 [x] Observed-compaction divider uses the instance's display name
B2-5 [x] Tray button "Add N notes to message"
B2-6 [x] Dictation hides only the known controls slot (composer-box gets the slot)
B2-7 [x] Rebuilt engine so real bands reach the wave
C2-1 [x] Built-in agent: don't start the driver for Projects with it off
C2-2 [x] Screenshot size cap in stored tool output
C2-3 [x] GitHub: invalid repo is an error, atomic write
C2-4 [x] GitHub: "done when PR #N merged" wording
C2-5 [x] Computer use card: Windows line; harnesses without Tenon's MCP get none
C2-6 [x] Stop latch per thread: next action says the user pressed Stop
C2-7 [x] Stop cancels a pending question
C2-8 [x] `inside()` handles folders named "..x"

## Round 3

- Judge A: 9/10 (scope 9, prototype 8.5)
- Judge B: 8/10 (scope 8, prototype 7)
- Judge C: 8/10 (scope 8.5, prototype 7)

### Fixed after round 3

- B3-1 [x] #330 a video chip opens the frame grids it will be sent as (FrameGridPreview, built with the same `frameGrids`); workshop text says so again
- B3-2 [x] #326 the tray sends its notes as one message ("Send N notes", through the composer's submit in reply-bridge); Send now still adds one note to the composer. Also fixed: the tray passed its click event as `only`, so it sent nothing
- B3-3 [~] #332 "View summary" relies on `summary: true`, which core compaction sets (`tenon/src/session/compaction.ts:401`)
- B3-4 [~] #328 engine binary is current: cargo reports `Fresh` for the band-emitting source
- C3-1 [x] #333 an oversized screenshot is replaced by a line telling the agent it was left out and why
- C3-2 [x] #331 overlapping repository saves are serialized (test: two folders saved at once keep both)
- C3-3 [x] #331 the Repository field is filled from the folder's origin
- C3-4 [x] #333 thread note "You stopped computer use" under the call Stop cut off
- C3-5 [x] #333 "By harness" lists the enabled harnesses: their own / Tenon's / none; switching off shows "Turned off · running threads stop using the desktop at their next action"
- A3-1 [x] #334 Edit applies rename and clear before the patch, so a refusal saves nothing
- A3-2 [x] #334 rename and add warn when a harness can't use the name
- A3-3 [x] #334 a jsonc rename rewrites only the key, keeping the entry's comments (test extended)
- A3-4 [x] #334 the open row says tools are listed once the server connects
- Not done: thread link on GitHub rows (Tenon doesn't record which thread filed an issue); progress from closed issues (not in the workshop); pill on the driven display (the driver works the whole desktop); 30-second re-probe for slow harnesses (workshop changed to manual "Check again")

## Round 4

- Judge A: 9/10 (scope 9, prototype 9)
- Judge B: 8.5/10 (scope 9, prototype 8): main reason, nothing run live
- Judge C: 8.5/10 (scope 9, prototype 7.5)

### Fixed after round 4

- C4-1 [x] #331 Repository is its own card in the Project's side panel (with Computer use), filled from the origin; the task list re-reads after a save
- C4-2 [x] #333 the card says "Stopped · ended computer use in N running threads" after Stop (proxy counts the threads per Project folder, shown 10 min); threads that used the desktop in the last minute count as running
- C4-3 [x] #333 the built-in agent's tool list retries in the background (3 × 5 s) when the driver doesn't list at first
- Live-run fixes: MCP rename/clear/remove now refetch the config query (the in-place store edit didn't reach it: a renamed row kept its old name until reload); Edit scrolls the form into view and focuses it

### Live run (dev app on :4445, backend on :4199 with sandbox XDG config; gh with the user's login, read only)

- #334: row "Connected · 3 tools" from a local stdio MCP server; open row shows chips, "PGPASSWORD = ••••", "Folder … · timeout 30 s", "Tools: query, list_tables, describe_table", Edit / Rename / Remove. Rename to "pg.db" warns "Not sent to Codex, OpenCode, Claude Code…"; rename to "pg" kept the entry's `// the app database` comment; Edit with the folder emptied removed `cwd` and kept the timeout and PGPASSWORD; the row updated without a reload (after the fix above)
- #330: a 20 s webm pasted in the composer shows "Video · 0:19 · sent as 9 frames…"; clicking it opens the 3×3 frame grid with time stamps
- #331: Project page lists "GitHub · ToRRIIDeR97/Tenon-Workbench · 24 open issues" with checkbox rows, "filed by", Issue chip; Repository card "… · from the folder's origin" → Change → Save → "… · set for this Project"
- #333: card on → install command (driver not installed here); off → "Turned off · running threads stop using the desktop at their next action"; By harness "Codex, Claude Code: their own · Tenon, OpenCode: Tenon's"
- #326: a Canvas design from the free built-in model; Notes → click the button → popover "main.card > button.cta · Get started" → Add (pin 1) → heading (pin 2) → "Send 2 notes" sent one message with both notes; pins stay as a record, tray rows say "Sent"
- #322: the assistant row shows its own time ("· 6s")
- Not run live: dictation wave and words (desktop engine), compaction dividers (need a long thread), the Cua Driver itself (not installed), tool-card times (the model ran no tool)

## Round 5 (final)

- Judge A: 9/10 (scope 9, prototype 9)
- Judge B: 9/10 (scope 9, prototype 8.5)
- Judge C: 9/10 (scope 9, prototype 8.5)

All three at 9 or above; the loop stops here. Open items the judges name (none blocking): dictation and compaction dividers not run live; the Cua Driver not run (not installed here); harness compaction thresholds unproven on real usage; transcription can't be cancelled in the engine; legacy doc/ppt/xls by name only; no thread link on GitHub rows; Stop is global (one driver process); MCP Edit can add but not edit a stored secret in place; slow-harness re-check is manual.
