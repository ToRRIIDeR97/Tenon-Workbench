# Deferred work

Source code carries no comments (see the root `AGENTS.md`), so known gaps and
deferred work live here, grouped by the file they belong to. Remove an item
when it ships.

## Core tools (`tenon/packages/core/src/tool`)

### Built-in list (`builtins.ts`)

- Port the remaining launch-follow-up leaves deliberately: edit fuzzy parity,
  task, LSP, repo_clone, repo_overview, and Rune/code mode. Keep MCP and plugin
  transforms separate from this static built-in list.

### Shell (`bash.ts`)

A minimal V2 shell boundary. Keep parity debt visible without pulling the
legacy shell runtime into core.

- TODO: Port tree-sitter bash / PowerShell parser-based approval reduction.
- TODO: Port BashArity reusable command-prefix approvals.
- TODO: Replace token-based command-argument external-directory advisories with parser-based detection.
- TODO: Restore PowerShell and cmd-specific invocation/path handling on Windows.
- TODO: Add plugin shell.env environment augmentation once V2 plugin hooks exist.
- TODO: Add durable/live progress metadata streaming for long-running commands once V2 tool invocation progress context is wired.
- TODO: Persist background job status and define restart recovery before exposing remote observation.
- TODO: Re-add model-facing background launch only with owner-bound get/wait/cancel tools and completion delivery.
- TODO: Add HTTP background-job observation only after durable status, restart recovery, and authorization are defined.
- TODO: Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.
- TODO: Revisit binary output handling if stdout/stderr decoding is text-only.
- TODO: Stream full shell output into managed storage while retaining only a bounded in-memory preview.

### Exact edit (`edit.ts`)

The model-facing V2 exact-edit leaf. Relative paths resolve within the active
Location. Absolute paths inside that Location are accepted, while explicit
absolute external paths retain mutation capability through a separate
external_directory approval before edit approval.

- TODO: Port V1 fuzzy correction strategies only after exact-edit behavior is established: line-trimmed matching, block-anchor fallback, indentation correction, and similarity-threshold review.
- TODO: Add formatter integration after V2 formatter runtime exists.
- TODO: Publish watcher/file-edit events after V2 watcher integration exists.
- TODO: Add snapshots / undo after design exists.
- TODO: Add LSP notification and diagnostics after V2 LSP runtime exists.

### File write (`write.ts`)

The model-facing V2 file-write leaf. Relative paths resolve within the active
Location. Absolute paths inside that Location are accepted, while explicit
absolute external paths retain mutation capability through a separate
external_directory approval before edit approval.

- TODO: Revisit whether model-facing mutation schemas should prefer absolute `filePath` naming for trained-in compatibility after evaluating model behavior.
- TODO: Add formatter integration after V2 formatter runtime exists.
- TODO: Publish watcher/file-edit events after V2 watcher integration exists.
- TODO: Add snapshots / undo after design exists.
- TODO: Add LSP notification and diagnostics after V2 LSP runtime exists.

## Core runtime (`tenon/packages/core/src`)

- `file-mutation.ts`: add formatter integration after the V2 formatter runtime
  exists; publish watcher/file-edit events after V2 watcher integration exists;
  add snapshots / undo after the V2 snapshot design exists; notify LSP and
  collect diagnostics after the V2 LSP runtime exists; design multi-file
  transactions / rollback if apply_patch needs atomic edits; define crash
  recovery and idempotency for side effects between Tool.Called and durable
  settlement.
- `event.ts`: bind durable projectors to exact type+version before supporting
  incompatible historical payloads.
- `session.ts`: restore recorded sessions onto replacement synchronized
  workspaces in a future API slice.
- `session/runner/to-llm-message.ts`: materialize remote and managed URIs before
  provider-history lowering.
- `catalog.ts`: remove the provider-specific deployment assumptions once model
  syncing reliably reports available deployments.
- `github-copilot/chat/openai-compatible-chat-language-model.ts`: restore type
  safety on the streamed chunk (lost, most likely, through the error schema).
- `github-copilot/responses/openai-responses-language-model.ts`: with AI SDK 6,
  use optional instead of nullish.
- `thread-sync/manager.ts`: a thread started on Windows cannot be continued on
  macOS yet. Its stored folder and project worktree are Windows drive paths,
  so `pull` and `continueHere` stop with `foreign_path` before the folder
  choice can apply; a later phase should let "Continue here" map the stored
  folder to a local one before the replay checks it.
- `thread-sync/manager.ts`: `threads()` downloads and opens every stored
  thread to report its local state; cache the comparison by manifest
  generation once lists grow.
- `thread-sync/drive.ts`: run the store against the live Google Drive API
  with the user's OAuth client (the sign-in exists since P5b; steps in
  `docs/records/thread-sync-manual-test.md`). Confirm that a second computer
  signed in through the same client sees the files under `drive.file`, and
  measure how soon a `files.list` shows a file another client just created:
  the emulated conditional write is exact only if it shows it at once.
- `app/src/components/settings-v2/sync.tsx`: say on the page that the Drive
  folder never needs sharing; drive "Continue here" end to end in a test
  (the folder picker is native, so only the route was driven in P5b).
- `thread-sync/drive.ts`: `list` reads every Tenon file in the Drive and
  each write lists the name twice; if that grows slow, keep a start page token
  from the Drive changes feed instead of listing again.

## Upstream engine (`tenon/packages/tenon/src`)

- `provider/provider.ts`: stop writing `process.env` directly (twice) once the
  scope of the Env API is settled; `Env.set` only updates a shallow copy. Remove
  the provider-specific deployment assumptions once model syncing reliably
  reports available deployments.
- `provider/transform.ts`: rewrite the inefficient transform function.
- `agent/agent.ts`: keep provider-specific logic from bleeding into agents.
- `account/account.ts`: let the user choose when there are multiple orgs.
- `control-plane/workspace.ts`: use `tapError` to set the status while still
  letting the fiber fail and be removed automatically.
- `format/index.ts`: combine formatters so shared backends like Ruff/uv don't
  need linked disable handling.
- `plugin/index.ts`: make proper events for plugin notifications.
- `session/session.ts`: reasoning tokens are charged at the output-token rate
  until models.dev has a better pricing model.
- `tool/tool.ts`: remove the workaround hack.
- `test/tool/shell.test.ts` ("tool.shell abort", 2 tests): fails only when the
  suite is started from PowerShell, because the shell tool then runs the
  test's `bun -e '…'` command in PowerShell, which cannot parse its quoting.
  It passes from Git Bash.

## Other packages

- `llm/src/protocols/openai-responses.ts`: read strict-schema behaviour from
  OpenAI-specific tool options so direct LLM callers can opt in.
- `server/src/handlers/pty.ts`: integrate graceful-shutdown socket tracking
  before clients migrate to this route.
- `client/src/effect.ts`: keep added network capabilities inside Schema and
  Protocol; `/effect` must never import Core or Server. Preserve the datatype
  exports so internal model reorganizations don't force caller migrations.
- `app/src/context/global-sync/child-store.ts`: after Home switches to
  `v2.project.list` and root-filtered, updated-time `v2.session.list`, remove
  any Home-only passive child creation.
- `app/src/context/global-sync/home-session-index.ts`: the full-table scan is
  needed because the current V2 API orders by creation time and can't filter
  roots, archives or multiple directories. Once released, use
  `client.v2.project.list()` and
  `client.v2.session.list({ parentID: null, order: "desc" })`, then remove this
  adapter and its V1 fields.
