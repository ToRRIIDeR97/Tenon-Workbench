export * as CommandSetup from "./command-setup"

import { KnowledgeVault } from "@/knowledge/vault"
import { BrainProject } from "@/project/brain"
import { InstanceStore } from "@/project/instance-store"
import { Effect, Schema } from "effect"
import { execFile } from "node:child_process"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { CommandVault } from "./command-vault"

/**
 * `project_setup`: start a new Project folder for the Command Centre. Creates the folder (refusing one
 * that already has files), runs `git init`, writes AGENTS.md, docs/system.md and docs/security.md from
 * templates that point at the tor-* skills, then adds the Project card and an empty timeline to the
 * workspace. Exposed to Command Centre sessions as an app tool (stage 2).
 */

export const Input = Schema.Struct({
  workspace: Schema.String,
  name: Schema.String,
  folder: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.String),
})
export type Input = typeof Input.Type

export class SetupError extends Schema.TaggedErrorClass<SetupError>()("CommandSetup.SetupError", {
  reason: Schema.String,
}) {}

export function templates(name: string): Record<string, string> {
  return {
    "AGENTS.md": `# ${name}

Repository rules for agents working in this Project.

## Workflow

- Run \`tor-project-setup\` once the first code lands, to fill in \`docs/system.md\`, \`docs/security.md\`
  and the diagrams from evidence in the code.
- Plan non-trivial changes with \`tor-implementation\`: a feature map, change diagrams, an
  \`implementation.md\` and acceptance tests before code.
- Before changing behaviour with wide effects, trace it with \`tor-feature-map-verification\` and keep
  before/after evidence.
- For phased work carried out by implementor and verifier agents, use \`tor-workflow\`.

## Documents

- [System](docs/system.md): components, responsibilities, interfaces and data flows.
- [Security](docs/security.md): assets, trust boundaries, secrets and checks.

Update the owning document in the same change when a component, boundary or data flow changes.
`,
    "docs/system.md": `# ${name}: system

Status: new Project, nothing built yet. Fill this in with \`tor-project-setup\` once code exists.

## Components

| Component | Responsibility | Inputs → outputs | Source |
| --- | --- | --- | --- |
| _unknown_ | | | |

## Data and storage

_Unknown until the first feature lands._
`,
    "docs/security.md": `# ${name}: security

Status: new Project. Review with \`tor-project-setup\` before the first release.

## Assets and sensitive data

_None recorded yet._

## Trust boundaries

_None recorded yet._

## Secrets

Never commit credentials. Record where each secret lives and who can read it.
`,
  }
}

const gitInit = (folder: string) =>
  Effect.callback<void, SetupError>((resume) => {
    // `git` from PATH on both Windows (git.exe) and macOS; no shell, so the folder is one argument.
    execFile("git", ["init", "--quiet"], { cwd: folder, windowsHide: true }, (error) =>
      resume(error ? Effect.fail(new SetupError({ reason: "git_init_failed" })) : Effect.void),
    )
  })

const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

export const run = Effect.fn("CommandSetup.run")(function* (input: Input) {
  const name = input.name.trim()
  if (!name) return yield* new SetupError({ reason: "invalid_name" })
  if (!input.workspace.trim() || !path.isAbsolute(input.workspace))
    return yield* new SetupError({ reason: "invalid_workspace" })
  const workspace = path.resolve(input.workspace)
  const folder = path.resolve(
    input.folder?.trim()
      ? path.resolve(workspace, input.folder.trim())
      : path.join(workspace, "projects", BrainProject.folderName(name)),
  )
  if (folder === workspace) return yield* new SetupError({ reason: "folder_is_workspace" })

  const existing = yield* Effect.promise(() => readdir(folder).catch(() => undefined))
  if (existing && existing.length > 0) return yield* new SetupError({ reason: "folder_not_empty" })
  const created = existing === undefined
  yield* Effect.promise(() => mkdir(folder, { recursive: true }))

  const files = Effect.gen(function* () {
    yield* gitInit(folder)
    for (const [relative, content] of Object.entries(templates(name))) {
      const target = path.join(folder, ...relative.split("/"))
      yield* Effect.promise(async () => {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, content, { flag: "wx" })
      })
    }
  })
  // A failed setup leaves no half-made folder behind (only one it created itself is removed).
  yield* files.pipe(
    Effect.onError(() =>
      created ? Effect.promise(() => rm(folder, { recursive: true, force: true })).pipe(Effect.ignore) : Effect.void,
    ),
  )

  const store = yield* InstanceStore.Service
  const location = inside(workspace, folder)
    ? {
        displayPath: path.relative(workspace, folder).split(path.sep).join("/"),
        path: path.relative(workspace, folder).split(path.sep).join("/"),
      }
    : { displayPath: folder, path: folder }
  const project = yield* store.provide(
    { directory: workspace },
    Effect.gen(function* () {
      const card = yield* CommandVault.inFolder(
        workspace,
        BrainProject.create({ name, outcome: input.outcome?.trim() || `Set up ${name}.`, location }),
      )
      if (!inside(workspace, folder))
        yield* CommandVault.inFolder(workspace, BrainProject.link({ folder })).pipe(
          Effect.catch((error) => Effect.logWarning("Linking the new Project folder failed", { error: error._tag })),
        )
      yield* CommandVault.withVault((vault) => KnowledgeVault.writeTimeline(vault, card.id, { items: [] }))
      return card
    }),
  )
  return { project, folder, files: Object.keys(templates(name)) }
})
