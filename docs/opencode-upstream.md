# OpenCode upstream

The `tenon/` directory is imported from `anomalyco/opencode` at commit
`bb72277407798e31e3f7d323c3144807238e0d6e` under the MIT License.

Keep the agent runtime, permission controls, Electron host, workspace access,
and session compatibility needed by Tenon Workbench. Add product behavior in
`tenon/packages/app` and native behavior in `tenon/packages/desktop`.
Hosted billing/console, public websites, statistics infrastructure, bots, editor
extensions, and upstream release automation have been removed from this fork.
So have the Storybook and `sdk-next` packages, upstream specs and perf notes,
the `.opencode/` config, the translation and OpenTUI upgrade scripts, and the
runtime calls and links to `opencode.ai` listed in the
[threat model](security/threat-model.md#outbound-network-endpoints).
`httpapi-codegen` stays because `packages/client` generates its SDK with it.

The terminal UI is gone too: the `tui` and `cli` packages,
`packages/tenon/src/cli/tui`, the `run` command, and the upstream
`github`, `pr`, `account`, `upgrade`, `uninstall`, `web`, `acp`, `attach`,
`stats`, `plug`, `export`, and `import` commands, and TUI plugin support: the
`@opencode-ai/plugin/tui` entry point and the OpenTUI packages. The plugin
loader skips a plugin that only exports `tui()` and loads the `server()` part
of one that exports both. The ACP harness driver in
`packages/core/src/harness/acp.ts` is unrelated and stays. A headless CLI
remains for development only; the SDK build runs its `generate` command. The
fork no longer builds or ships an `opencode` binary.

The GitLab Duo model provider (`gitlab-ai-provider`) and the GitLab sign-in
plugin (`opencode-gitlab-auth`) are removed. models.dev providers built on a
removed SDK package are dropped from the catalogue (`core/src/models-dev.ts`),
so a saved `gitlab` provider config, `GITLAB_TOKEN`, or `auth.json` entry is
ignored. GitLab remotes and GitLab file icons are unaffected.

Owned code uses Tenon names: the `tenon/` folder and `packages/tenon`, the
`@tenon/*` workspace packages, `TENON_*` environment variables, `tenon.json`
and `.tenon/` config, `x-tenon-*` headers, and `tenon.*` store and database
files. The pre-rename names still work: `OPENCODE_*` variables are copied to
their `TENON_*` names at startup (`core/src/legacy-env.ts`), `opencode.json`
and `.opencode/` still load with lower priority than the Tenon names
(`core/src/config/names.ts`), the server accepts the `x-opencode-*` headers the
app and SDK still send to upstream servers, and `opencode.*` store files,
`opencode*.db` and `opencode.`/`opencode-theme-*` browser storage keys move to
their Tenon names once. Names that refer to upstream OpenCode itself (the ACP
harness and WSL CLI, the OpenCode Zen provider, `opencode.ai`, the published
`@opencode-ai/sdk` and `@opencode-ai/plugin` packages) are unchanged. Display
names use Tenon Workbench. Automatic updates
are disabled until the fork has its own verified signed release feed.

The import contains ordinary files instead of 60 upstream symbolic links so it
works from Windows workspaces without Developer Mode.
