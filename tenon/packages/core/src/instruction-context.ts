export * as InstructionContext from "./instruction-context"

import { Array, Context, Effect, Layer, Schema } from "effect"
import { dirname, isAbsolute, join, relative, sep } from "path"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { Global } from "./global"
import { Location } from "./location"
import { AbsolutePath } from "./schema"
import { SystemContext } from "./system-context/index"
import { SystemContextRegistry } from "./system-context/registry"
import { makeLocationNode } from "./effect/app-node"
import { WorkspaceInstructions } from "./workspace-instructions"

class File extends Schema.Class<File>("InstructionContext.File")({
  path: AbsolutePath,
  content: Schema.String,
}) {}

const Files = Schema.Array(File)

/**
 * Who the instructions are for. A delegate (a thread another thread started to do one step) reads `DELEGATE.md` in
 * place of each `AGENTS.md` that has one beside it, so lead-agent workflow rules don't make it onboard itself.
 * The session runner sets it per thread; everything else gets the lead's files.
 */
export const Role = Context.Reference<"lead" | "delegate">("@tenon/InstructionContext/Role", {
  defaultValue: () => "lead",
})
const DELEGATE_FILE = "DELEGATE.md"
const key = SystemContext.Key.make("core/instructions")
const readLimit = 256 * 1024

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service

    const source = (value: ReadonlyArray<File> | SystemContext.Unavailable) =>
      SystemContext.make({
        key,
        codec: Schema.toCodecJson(Files),
        load: Effect.succeed(value),
        baseline: render,
        update: (_previous, current) =>
          `These instructions replace all previously loaded ambient instructions.\n\n${render(current)}`,
        removed: () => "Previously loaded instructions no longer apply.",
      })

    const observe = Effect.fn("InstructionContext.observe")(function* () {
      const start = yield* fs.resolve(location.directory)
      const stop = yield* fs.resolve(location.project.directory)
      const fromProject = relative(stop, start)
      const insideProject =
        fromProject === "" || (fromProject !== ".." && !fromProject.startsWith(`..${sep}`) && !isAbsolute(fromProject))
      // In a Tenon workspace the project's AGENTS.md replaces the workspace one instead of stacking.
      const workspace = Flag.TENON_DISABLE_PROJECT_CONFIG
        ? undefined
        : yield* WorkspaceInstructions.resolve(start, global.data).pipe(Effect.provideService(FSUtil.Service, fs))
      const found = yield* Effect.forEach(
        workspace ??
          (Flag.TENON_DISABLE_PROJECT_CONFIG || !insideProject
            ? []
            : yield* fs.up({
                targets: ["AGENTS.md"],
                start,
                stop,
              })),
        fs.resolve,
      )
      // `fs.resolve` follows symlinks: a project AGENTS.md must really live inside the project.
      // WorkspaceInstructions applies the same check against the workspace or linked folder.
      const discovered = new Set(workspace ? found : found.filter((path) => FSUtil.contains(stop, path)))
      const agents = Array.dedupe([yield* fs.resolve(join(global.config, "AGENTS.md")), ...discovered])
      // A delegate's DELEGATE.md must really sit beside the AGENTS.md it replaces, as that one must sit in the project.
      const paths =
        (yield* Role) === "lead"
          ? agents
          : yield* Effect.forEach(agents, (path) =>
              Effect.gen(function* () {
                const candidate = join(dirname(path), DELEGATE_FILE)
                if (!(yield* fs.stat(candidate).pipe(Effect.orElseSucceed(() => undefined)))) return path
                const resolved = yield* fs.resolve(candidate)
                return FSUtil.contains(dirname(path), resolved) ? resolved : path
              }),
            )
      const files = yield* Effect.forEach(
        paths,
        (path) =>
          Effect.gen(function* () {
            // An oversized file counts as unreadable rather than flooding every session's context.
            const stat = yield* fs.stat(path).pipe(Effect.orElseSucceed(() => undefined))
            if (stat && Number(stat.size) > readLimit) return undefined
            const content = yield* fs.readFileStringSafe(path)
            return content === undefined ? undefined : new File({ path: AbsolutePath.make(path), content })
          }),
        { concurrency: "unbounded" },
      )
      if (files.some((file, index) => file === undefined && discovered.has(agents[index])))
        return SystemContext.unavailable
      return files.filter((file): file is File => file !== undefined)
    })

    yield* registry.register({
      key,
      load: observe().pipe(
        Effect.map((files) =>
          files === SystemContext.unavailable
            ? source(files)
            : files.length === 0
              ? SystemContext.empty
              : source(files),
        ),
        Effect.catch(() => Effect.succeed(source(SystemContext.unavailable))),
        Effect.catchDefect(() => Effect.succeed(source(SystemContext.unavailable))),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "instruction-context",
  layer,
  deps: [FSUtil.node, Global.node, Location.node, SystemContextRegistry.node],
})

function render(files: ReadonlyArray<File>) {
  return files.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n")
}
