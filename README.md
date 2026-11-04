# Tenon Workbench

A local-first, agent-powered second brain for files, notes, projects, and
planning. The Electron app builds on OpenCode's agent, session, terminal, and
file workflows. Brain home is the starting point; workspace management is
available through its Open workspace actions.

## Prerequisites

- Bun 1.3.14
- Node.js 24 for desktop tests and release tooling
- The platform prerequisites required by Electron

On macOS, install Xcode Command Line Tools with `xcode-select --install`.

## Setup

```sh
cd tenon
bun install --frozen-lockfile
cd ..
bun run dev
```

Keep the checkout outside OneDrive, iCloud and other synced folders if you can.
Each build rewrites hundreds of megabytes under `tenon/packages/*/dist`,
`tenon/packages/desktop/out` and `node_modules`, and a sync client has to follow
all of it.

On Windows, native package installation can exceed the legacy 260-character
limit when this repository lives under a long OneDrive path. Prefer a shorter
checkout path. For this checkout, the verified fallback is:

```powershell
cd tenon
bun install --ignore-scripts
node packages/desktop/node_modules/electron/install.js
cd ..
bun run dev
```

The previous React/Tauri application is retired. Its schemas, recovery source
revision, and migration gaps are recorded in [the archive](docs/archive/tauri/README.md).

## Common commands

| Command                     | Purpose                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `bun run dev`               | Start the Tenon Workbench Electron app                     |
| `bun run build`             | Build the Electron renderer and main process               |
| `bun run desktop:build`     | Build and package an unsigned Windows candidate            |
| `bun run typecheck`         | Typecheck every package and the app e2e specs via turbo    |
| `bun run lint`              | Run the linter (oxlint)                                    |
| `bun run test`              | Run package tests (engine suites excluded) via turbo       |
| `bun run check:generated`   | Fail if the generated client in `packages/client` is stale |
| `bun run check`             | Run typecheck, lint, format, generated, test, and build    |
| `bun run test:engine`       | Run the full core and server suites                        |
| `bun run test:routes`       | Check Brain home and workspace navigation in Chromium      |
| `bun run test:second-brain` | Run the notes, planner and Project card server tests       |
| `bun run test:desktop`      | Run the Electron main-process tests                        |
| `bun run test:app`          | Run the renderer unit tests                                |
| `bun run desktop:dev`       | Same as `bun run dev`                                      |
| `bun run format:check`      | Check Prettier formatting of every `tenon/` package        |

The fork is pinned and documented in
[docs/opencode-upstream.md](docs/opencode-upstream.md).
Release artifacts and verification limits are documented in
[release operations](docs/release-operations.md).
