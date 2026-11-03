# Command Centre: full thread view, model pill and agent instructions

## Problem

- A Command Centre thread shows only plain message text, with no reasoning, tool calls or step-by-step
  work. A Project thread shows all of that.
- The Command Centre composer has no harness, model or reasoning choice; it always uses the Settings default.
- The Command Centre agent doesn't know it is the Command Centre agent: no instructions tell it its
  purpose, tools or limits.

Before: asking the Command Centre "add Friday's review to my calendar" shows a text reply. After: the reply
opens in the same thread view as a Project thread, with its reasoning, the `calendar_apply` tool call and
the write card, but without git diff, review, files or terminal. The agent answers as the Command Centre.

Decision (user, 2026-11-03): Command Centre threads open in the regular thread view, not inside the
Command Centre page.

## Feature map

| Component | Today | Source |
|---|---|---|
| Command Centre folder | `<vault>/.command-centre`, created by `CommandMemory.directory()` | `tenon/src/agents/command-memory.ts` |
| Instructions | Each thread loads `AGENTS.md` found walking up from its folder (`Instruction.systemPaths`, `findUp` to the project root, `/` for the global project) | `tenon/src/session/instruction.ts`, `project/project.ts` `fromDirectory` |
| Send | `centre.send(text, thread)` creates the session with the Settings harness/model and prompts it | `features/command-centre/command-centre.tsx` |
| Page | Thread list, memory search, a plain message list and the writes step list | `pages/command-centre.tsx` |
| Strip | Latest reply, Undo, compact composer, "Open full" → `/command?thread=` | `features/command-centre/command-strip.tsx` |
| Thread view | Timeline (reasoning, tools, inline write cards), composer, review/files/terminal panels and their toggles | `pages/session.tsx`, `session-header.tsx`, `use-session-commands.tsx` |
| Home harness choice | Inline in Home: harness query, fallback, model reconciliation, pill controller | `pages/brain-home.tsx` |

## Acceptance criteria

- **AC-1 Instructions.** Opening the Command Centre folder writes `AGENTS.md` from
  `tenon/src/agents/command-agent.md`. An older copy that still has the managed first line is refreshed;
  a file without it (the user's own) is left alone. Checked by `tenon/test/agents/command-agent-instructions.test.ts`.
- **AC-2 Command thread view.** A thread whose folder is the Command Centre folder (`isCommandThread`)
  opens in the thread view without:
  - the review/side panel, file tree, terminal and side rail;
  - the header's review and terminal buttons;
  - the `review.toggle`, `terminal.toggle`, `terminal.new`, `fileTree.toggle` and `file.open` commands.
  Project threads are unchanged.
- **AC-3 Page.** On `/command`:
  - Choosing a thread, or a memory hit that has a thread, opens that thread in the thread view.
  - The composer shows the model pill. It starts on Settings › Command Centre's harness and model.
  - Sending starts a fresh thread with the pill's harness, model, reasoning and speed, then opens it.
  - An old `/command?thread=<id>` link opens that thread.
- **AC-4 Strip.** "Open full" opens the latest thread in the thread view, or `/command` when there is none.
  Sending from the strip still uses the Settings default.
- **AC-5 One harness choice.** Home and the Command Centre page use one shared `createComposerHarness`;
  Home's behaviour is unchanged.
- **AC-6** `bun run check`, `bun run test:routes`, and the Command Centre and Home specs pass.

The Command Centre page no longer shows the writes step list (old AC-7.7). The writes of a Command Centre
thread now show as inline cards in its thread view, as for Project threads (AC-6.1).
`e2e/acceptance/command-centre.spec.ts` is updated to match.

| AC | Check |
|---|---|
| AC-1 | `tenon/test/agents/command-agent-instructions.test.ts` |
| AC-2 | `acceptance/app/command-thread.test.ts` (`isCommandThread`), e2e command-centre spec (no review/terminal buttons) |
| AC-3 | e2e command-centre spec (thread link, model pill, `?thread=` link) |
| AC-4 | e2e command-centre spec ("Open full") |
| AC-5 | e2e `brain-home-loading`, `brain-home-model-picker` |
| AC-6 | commands below |

## Verification

From `tenon/packages/app`:

```sh
bun test --conditions=solid --preload ./happydom.ts ../../../Implementations/command-centre-thread/acceptance/app/
bunx playwright test e2e/acceptance/command-centre.spec.ts e2e/regression/brain-home-loading.spec.ts e2e/regression/brain-home-model-picker.spec.ts --workers=1
```

From `tenon/packages/tenon`: `bun test test/agents/command-agent-instructions.test.ts`.
From the repository root: `bun run check`, `bun run test:routes`.

## Completion evidence

Implemented as planned. Beyond the plan:

- `HomeModelPill` moved to `components/prompt-input/folder-model-pill.tsx` as `FolderModelPill`, so the
  shared `ComposerModelPill` doesn't import from `pages/`.
- The step list (`AgentWriteSteps`) and the writes store's `focus` (which hid the pill for the thread open
  on the Command Centre page) had no users left, so they are removed.
- The page's composer pill starts on Settings › Command Centre's harness. For the built-in agent it shows
  the folder's own model selection, as Home does, so a Settings default built-in model (`provider/model`)
  applies only to the strip.

Checks run (same author):

- Acceptance set: 2 pass (with the shared-composer sets, 17 pass).
- `tenon/test/agents/command-agent-instructions.test.ts`: 4 pass.
- `bun run check`: pass.
- `bun run test:routes`: 11 pass.
- `command-centre.spec.ts`: 10 pass.
- `brain-home-loading`, `brain-home-model-picker` and `review-open-file`: 3 pass.
- The built server bundle (`desktop/out/main/chunks/node-*.js`) embeds `command-agent.md` as text.
- Isolated server with a scratch vault: `POST /command-centre/directory` wrote
  `.command-centre/AGENTS.md`. A Command Centre thread in the web preview showed the composer with the
  model pill, and no review rail, review button or terminal button.

Not verified:

- A live model turn reading the instructions. Loading follows from the source: `Instruction.systemPaths`
  calls `findUp("AGENTS.md", <thread folder>, <worktree>)`, and the worktree is `/` for the non-git global
  project.
- Reasoning and tool-call rendering for a real Command Centre reply. These use the same timeline as Project
  threads, which this change doesn't touch.
