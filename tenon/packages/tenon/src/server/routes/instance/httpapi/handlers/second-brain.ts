import { CommandMemory } from "@/agents/command-memory"
import { CommandThreads } from "@/agents/command-threads"
import { Routines } from "@/agents/routines"
import { RoutinesScheduler } from "@/agents/routines-scheduler"
import { InstanceState } from "@/effect/instance-state"
import { InstanceStore } from "@/project/instance-store"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { KnowledgeNote } from "@/knowledge/note"
import { KnowledgeVault } from "@/knowledge/vault"
import { AgentAppTools } from "@/agents/app-tools"
import { PlannerCalendar } from "@/planner/calendar"
import { PlannerCalendarStore } from "@/planner/calendar-store"
import { BrainProject } from "@/project/brain"
import { Project } from "@/project/project"
import { Database } from "@tenon/core/database/database"
import { KeyedMutex } from "@tenon/core/effect/keyed-mutex"
import { FSUtil } from "@tenon/core/fs-util"
import { Global } from "@tenon/core/global"
import { Location } from "@tenon/core/location"
import { LocationMutation } from "@tenon/core/location-mutation"
import { LocationServiceMap, locationServiceMapLayer } from "@tenon/core/location-services"
import { AbsolutePath } from "@tenon/core/schema"
import { ProjectV2 } from "@tenon/core/project"
import { Effect, Layer } from "effect"
import { PlatformError } from "effect/PlatformError"
import path from "node:path"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { SecondBrainConflictError, SecondBrainInvalidError } from "../groups/second-brain"

const CALENDAR_PATH = PlannerCalendarStore.CALENDAR_PATH

type ApiFailure =
  | SecondBrainInvalidError
  | HttpApiError.NotFound
  | SecondBrainConflictError
  | HttpApiError.InternalServerError

export const secondBrainHandlers = HttpApiBuilder.group(InstanceHttpApi, "secondBrain", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const projectService = yield* Project.Service
    const database = yield* Database.Service
    const sessions = yield* Session.Service
    const prompts = yield* SessionPrompt.Service
    const instances = yield* InstanceStore.Service
    const llm = yield* LLM.Service
    const provider = yield* Provider.Service
    // One lock per Brain directory serializes calendar saves (with their timeline sync),
    // Project mutations and project folder scans, so none of them interleave.
    const brainLocks = KeyedMutex.makeUnsafe<string>()
    const filesystem = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
        ),
      )
    })
    const serialized = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* brainLocks.withLock((yield* InstanceState.context).directory)(effect)
    })

    const listNotes = Effect.fn("SecondBrain.listNotes")(function* (ctx: { query: { search?: string } }) {
      return yield* filesystem(KnowledgeNote.list(ctx.query.search)).pipe(failure("listNotes"))
    })

    const readNote = Effect.fn("SecondBrain.readNote")(function* (ctx: { query: { path: string } }) {
      return yield* filesystem(KnowledgeNote.read(ctx.query.path)).pipe(failure("readNote", ctx.query.path))
    })

    // The pre-vault write route. Project folders are never written to, so a `notes/<page>.md` or Project card
    // note path is saved as the matching vault page instead (the vault opens with the notes moved in first).
    const writeNote = Effect.fn("SecondBrain.writeNote")(function* (ctx: {
      query: { path: string }
      payload: KnowledgeNote.WriteInput
    }) {
      const relative = ctx.query.path.replaceAll("\\", "/").replace(/^\.\//, "")
      const card = /^(?:\.tenon\/)?projects\/(project_[0-9A-Z]+)\/notes\/(.+\.md)$/i.exec(relative)
      const page = card?.[2] ?? (/^notes\/.+\.md$/i.test(relative) ? relative.slice("notes/".length) : undefined)
      if (page === undefined) return yield* invalid("invalid_path")
      const written = yield* vault(
        "writeNote",
        (opened) =>
          KnowledgeVault.writePage(opened, page, {
            body: ctx.payload.body,
            title: ctx.payload.title,
            projectId: card?.[1],
            expectedRevision: ctx.payload.expectedRevision,
            create: ctx.payload.create,
          }),
        ctx.query.path,
      )
      return {
        info: {
          path: written.info.path,
          title: written.info.title,
          projectIds: written.info.projectId ? [written.info.projectId] : [],
          tags: [],
          links: [],
          updatedAt: written.info.updatedAt,
        },
        body: written.body,
        revision: written.revision,
      }
    })

    const deleteNote = Effect.fn("SecondBrain.deleteNote")(function* (ctx: {
      query: { path: string; expectedRevision: string }
    }) {
      return yield* filesystem(
        KnowledgeNote.remove(ctx.query.path, { expectedRevision: ctx.query.expectedRevision }),
      ).pipe(failure("deleteNote", ctx.query.path))
    })

    const readCalendar = Effect.fn("SecondBrain.readCalendar")(function* () {
      return yield* filesystem(PlannerCalendarStore.read()).pipe(failure("readCalendar", CALENDAR_PATH))
    })

    const writeCalendar = Effect.fn("SecondBrain.writeCalendar")(function* (ctx: {
      payload: PlannerCalendar.WriteInput
    }) {
      return yield* serialized(filesystem(PlannerCalendarStore.save(ctx.payload))).pipe(
        failure("writeCalendar", CALENDAR_PATH),
      )
    })

    const listProjects = Effect.fn("SecondBrain.listProjects")(function* () {
      return yield* filesystem(BrainProject.list()).pipe(failure("listProjects"))
    })

    // A new Project has no calendar items yet, so creating one does not re-sync timelines.
    const createProject = Effect.fn("SecondBrain.createProject")(function* (ctx: {
      payload: BrainProject.CreateInput
    }) {
      return yield* serialized(filesystem(BrainProject.create(ctx.payload))).pipe(failure("createProject"))
    })

    const workspaces = Effect.fn("SecondBrain.workspaces")(function* () {
      return (yield* projectService.list()).map(
        (project): BrainProject.Workspace => ({
          id: project.id,
          worktree: project.worktree,
          ...(project.name ? { name: project.name } : {}),
        }),
      )
    })

    const listProjectThreads = Effect.fn("SecondBrain.listProjectThreads")(function* () {
      const known = yield* workspaces()
      return yield* filesystem(
        Effect.gen(function* () {
          const projects = yield* BrainProject.list()
          const linked = yield* BrainProject.linkedFolders().pipe(Effect.provideService(Global.Service, Global.make()))
          const resolved = yield* Effect.forEach(
            projects,
            (project) =>
              BrainProject.threadDirectory(project, known, linked).pipe(Effect.map((thread) => ({ project, thread }))),
            { concurrency: 8 },
          )
          const stats = yield* BrainProject.threadStats(resolved.map((item) => item.thread.directory)).pipe(
            Effect.provideService(Database.Service, database),
          )
          return resolved.map(({ project, thread }): BrainProject.ThreadSummary => {
            const stat = stats.get(thread.directory)
            return {
              project,
              threadDirectory: thread.directory,
              threadDirectoryKind: thread.kind,
              workspace: thread.workspace ?? null,
              rootSessionCount: stat?.count ?? 0,
              lastActivityAt: stat?.lastActivityAt ?? null,
            }
          })
        }),
      ).pipe(failure("listProjectThreads"))
    })

    const ensureWorkspaceProject = Effect.fn("SecondBrain.ensureWorkspaceProject")(function* (ctx: {
      payload: BrainProject.EnsureWorkspaceInput
    }) {
      const id = ctx.payload.workspaceId.trim()
      if (!id || id === "global") return yield* invalid("invalid_workspace")
      const workspace = yield* projectService.get(ProjectV2.ID.make(id))
      if (!workspace) return yield* new HttpApiError.NotFound({})
      const brainDirectory = (yield* InstanceState.context).directory
      if (path.resolve(workspace.worktree) === path.resolve(brainDirectory)) return yield* invalid("invalid_workspace")
      const result = yield* serialized(
        filesystem(BrainProject.ensureForWorkspace({ id: workspace.id, worktree: workspace.worktree })),
      ).pipe(failure("ensureWorkspaceProject"))
      return result.project
    })

    const scanProjects = Effect.fn("SecondBrain.scanProjects")(function* () {
      return yield* serialized(
        filesystem(BrainProject.scan().pipe(Effect.provideService(Global.Service, Global.make()))),
      ).pipe(failure("scanProjects"))
    })

    const linkProjectFolder = Effect.fn("SecondBrain.linkProjectFolder")(function* (ctx: {
      payload: BrainProject.LinkInput
    }) {
      return yield* serialized(
        filesystem(BrainProject.link(ctx.payload).pipe(Effect.provideService(Global.Service, Global.make()))),
      ).pipe(failure("linkProjectFolder"))
    })

    const unlinkProjectFolder = Effect.fn("SecondBrain.unlinkProjectFolder")(function* (ctx: {
      payload: BrainProject.LinkInput
    }) {
      return yield* serialized(
        filesystem(BrainProject.unlink(ctx.payload).pipe(Effect.provideService(Global.Service, Global.make()))),
      ).pipe(failure("unlinkProjectFolder"))
    })

    const readInstructions = Effect.fn("SecondBrain.readInstructions")(function* () {
      return yield* filesystem(BrainProject.readInstructions()).pipe(failure("readInstructions", "AGENTS.md"))
    })

    const writeInstructions = Effect.fn("SecondBrain.writeInstructions")(function* (ctx: {
      payload: BrainProject.InstructionsInput
    }) {
      return yield* filesystem(BrainProject.writeInstructions(ctx.payload)).pipe(
        failure("writeInstructions", "AGENTS.md"),
      )
    })

    const removeInstructions = Effect.fn("SecondBrain.removeInstructions")(function* () {
      return yield* filesystem(BrainProject.removeInstructions()).pipe(failure("removeInstructions", "AGENTS.md"))
    })

    const readProject = Effect.fn("SecondBrain.readProject")(function* (ctx: { query: { id: string } }) {
      return yield* filesystem(BrainProject.get(ctx.query.id)).pipe(failure("readProject", ctx.query.id))
    })

    const updateProject = Effect.fn("SecondBrain.updateProject")(function* (ctx: {
      query: { id: string }
      payload: BrainProject.UpdateInput
    }) {
      return yield* serialized(filesystem(BrainProject.update(ctx.query.id, ctx.payload))).pipe(
        failure("updateProject", ctx.query.id),
      )
    })

    // Workspace folders whose pre-vault notes this process has moved into the vault (see `vault`).
    const migrated = new Set<string>()
    const migrateFirst = (directory: string) => (opened: KnowledgeVault.Vault) => {
      const key = `${opened.directory}\n${directory}`
      if (migrated.has(key)) return Effect.void
      return KnowledgeVault.migrate(opened).pipe(
        Effect.tap(() => Effect.sync(() => migrated.add(key))),
        Effect.catch((error) =>
          Effect.logWarning("Moving workspace notes into the vault failed", { error: String(error) }),
        ),
        Effect.asVoid,
      )
    }

    // Vault work runs with the workspace's filesystem services (Project names come from its cards). The first
    // vault request of each workspace in this process moves its pre-vault notes in, so the move does not rely on
    // the app having called the migrate route; that route itself (`moveNotes: false`) reports what it moved.
    const vault = Effect.fnUntraced(function* <A, E, R>(
      operation: string,
      run: (vault: KnowledgeVault.Vault) => Effect.Effect<A, E, R>,
      relative?: string,
      moveNotes = true,
    ) {
      const context = yield* InstanceState.context
      const workspace = KnowledgeVault.workspaceFor(context)
      return yield* filesystem(
        KnowledgeVault.open(workspace).pipe(
          Effect.tap(moveNotes ? migrateFirst(context.directory) : () => Effect.void),
          Effect.flatMap(run),
          Effect.provideService(Global.Service, Global.make()),
        ),
      ).pipe(failure(operation, relative))
    })

    // The undo token is the capability: it is random, single-use and names the write it reverts.
    const undoWrite = Effect.fn("SecondBrain.undoWrite")(function* (ctx: { params: { undo: string } }) {
      const result = yield* AgentAppTools.undo(ctx.params.undo)
      if (result === "missing") return yield* new HttpApiError.NotFound({})
      if (result !== "undone") return yield* conflict(result)
      return { undone: true as const }
    })

    // Command Centre work reads threads machine-wide and starts threads in the vault's .command-centre folder.
    const commandServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(Session.Service, sessions),
        Effect.provideService(Database.Service, database),
        Effect.provideService(SessionPrompt.Service, prompts),
        Effect.provideService(InstanceStore.Service, instances),
        Effect.provideService(LLM.Service, llm),
        Effect.provideService(Provider.Service, provider),
        Effect.provideService(LocationServiceMap.Service, locations),
      )

    // Run now and scheduled runs agree: the routine's own model first, then the Command Centre default the
    // renderer sends (remembered for the scheduler, which has no renderer to ask).
    const startRoutine = (model?: CommandThreads.ModelChoice) => (routine: Routines.Routine) =>
      Routines.rememberDefaultModel(model).pipe(
        Effect.andThen(
          commandServices(
            CommandThreads.start({
              prompt: routine.prompt,
              title: routine.name,
              model: RoutinesScheduler.modelChoice(routine.model) ?? model,
            }),
          ),
        ),
        Effect.map((started) => ({ threadId: started.threadId, reply: commandServices(started.reply) })),
      )

    return handlers
      .handle("undoWrite", undoWrite)
      .handle("listRoutines", () => commandServices(Routines.list()).pipe(failure("listRoutines")))
      .handle("runRoutine", (ctx) =>
        commandServices(Routines.runNow({ id: ctx.params.id, start: startRoutine(ctx.payload.model) })).pipe(
          failure("runRoutine", ctx.params.id),
        ),
      )
      .handle("commandDirectory", () =>
        CommandMemory.directory().pipe(
          Effect.map((directory) => ({ directory })),
          failure("commandDirectory"),
        ),
      )
      .handle("commandFolders", () => Effect.sync(() => ({ folders: CommandMemory.folders() })))
      .handle("searchCommandMemory", (ctx) =>
        commandServices(CommandMemory.search(ctx.query.search ?? "")).pipe(failure("searchCommandMemory")),
      )
      .handle("compactCommandMemory", (ctx) =>
        commandServices(
          Effect.gen(function* () {
            // The summariser is only built when a thread is old enough, so an idle compaction needs no model.
            let summarize: ((thread: CommandMemory.Thread) => Effect.Effect<string, unknown>) | undefined
            // The renderer sends the Command Centre default here hourly; scheduled routines fall back to it.
            yield* Routines.rememberDefaultModel(ctx.payload.model)
            return yield* CommandMemory.compact({
              days: ctx.payload.days,
              summarize: (thread) =>
                Effect.gen(function* () {
                  summarize ??= yield* commandServices(CommandThreads.summarizer(ctx.payload.model))
                  return yield* summarize(thread)
                }),
            })
          }),
        ).pipe(failure("compactCommandMemory")),
      )
      .handle("readVault", () => vault("readVault", (opened) => Effect.succeed(KnowledgeVault.info(opened))))
      .handle("listVaultPages", (ctx) =>
        vault("listVaultPages", (opened) =>
          KnowledgeVault.listPages(opened, { project: ctx.query.project, search: ctx.query.search }),
        ),
      )
      .handle("readVaultPage", (ctx) =>
        vault("readVaultPage", (opened) => KnowledgeVault.readPage(opened, ctx.query.path), ctx.query.path),
      )
      .handle("writeVaultPage", (ctx) =>
        vault(
          "writeVaultPage",
          (opened) => KnowledgeVault.writePage(opened, ctx.query.path, ctx.payload),
          ctx.query.path,
        ),
      )
      .handle("readVaultPageHistory", (ctx) =>
        vault(
          "readVaultPageHistory",
          (opened) => KnowledgeVault.history(opened, ctx.query.path, ctx.query.revision),
          ctx.query.path,
        ),
      )
      .handle("readVaultTimeline", (ctx) =>
        vault("readVaultTimeline", (opened) => KnowledgeVault.readTimeline(opened, ctx.query.project)),
      )
      .handle("writeVaultTimeline", (ctx) =>
        vault("writeVaultTimeline", (opened) => KnowledgeVault.writeTimeline(opened, ctx.query.project, ctx.payload)),
      )
      .handle("readVaultLog", (ctx) =>
        vault("readVaultLog", (opened) => KnowledgeVault.readLog(opened, ctx.query.project)),
      )
      .handle("appendVaultLog", (ctx) =>
        vault("appendVaultLog", (opened) => KnowledgeVault.appendLog(opened, ctx.query.project, ctx.payload)),
      )
      .handle("listVaultConflicts", () => vault("listVaultConflicts", KnowledgeVault.conflicts))
      .handle("migrateVault", () =>
        serialized(
          Effect.gen(function* () {
            const directory = (yield* InstanceState.context).directory
            return yield* vault(
              "migrateVault",
              (opened) =>
                KnowledgeVault.migrate(opened).pipe(
                  Effect.tap(() => Effect.sync(() => migrated.add(`${opened.directory}\n${directory}`))),
                ),
              undefined,
              false,
            )
          }),
        ),
      )
      .handle("listNotes", listNotes)
      .handle("readNote", readNote)
      .handle("writeNote", writeNote)
      .handle("deleteNote", deleteNote)
      .handle("readCalendar", readCalendar)
      .handle("writeCalendar", writeCalendar)
      .handle("listProjects", listProjects)
      .handle("createProject", createProject)
      .handle("listProjectThreads", listProjectThreads)
      .handle("ensureWorkspaceProject", ensureWorkspaceProject)
      .handle("scanProjects", scanProjects)
      .handle("linkProjectFolder", linkProjectFolder)
      .handle("unlinkProjectFolder", unlinkProjectFolder)
      .handle("readInstructions", readInstructions)
      .handle("writeInstructions", writeInstructions)
      .handle("removeInstructions", removeInstructions)
      .handle("readProject", readProject)
      .handle("updateProject", updateProject)
  }),
).pipe(Layer.provide(locationServiceMapLayer))

/**
 * Translate every Second Brain failure at one boundary: domain validation is a 400
 * carrying its reason, a missing record 404, a stale write 409, and anything else
 * (IO, permissions) a logged 500. Logs carry the error tag, reason and the
 * request's relative path or id, never file content.
 */
function failure(operation: string, path?: string) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ApiFailure, R> =>
    effect.pipe(Effect.catch((error) => toApiFailure(operation, path, error)))
}

function toApiFailure(operation: string, path: string | undefined, error: unknown): Effect.Effect<never, ApiFailure> {
  if (
    error instanceof SecondBrainInvalidError ||
    error instanceof HttpApiError.NotFound ||
    error instanceof SecondBrainConflictError ||
    error instanceof HttpApiError.InternalServerError
  ) {
    return Effect.fail(error)
  }
  if (
    error instanceof Routines.NotFoundError ||
    error instanceof KnowledgeNote.NotFoundError ||
    error instanceof KnowledgeVault.NotFoundError ||
    error instanceof BrainProject.NotFoundError
  ) {
    return Effect.fail(new HttpApiError.NotFound({}))
  }
  if (
    error instanceof KnowledgeNote.ConflictError ||
    error instanceof KnowledgeVault.ConflictError ||
    error instanceof PlannerCalendarStore.ConflictError ||
    error instanceof BrainProject.ConflictError
  ) {
    return Effect.fail(conflict(error.reason))
  }
  if (
    error instanceof KnowledgeNote.InvalidError ||
    error instanceof KnowledgeVault.InvalidError ||
    error instanceof BrainProject.InvalidError ||
    error instanceof PlannerCalendar.InvalidError ||
    error instanceof LocationMutation.PathError
  ) {
    return Effect.logWarning("Second Brain request rejected", {
      operation,
      path,
      error: error._tag,
      reason: error.reason,
    }).pipe(Effect.andThen(Effect.fail(invalid(error.reason))))
  }
  return Effect.logError("Second Brain request failed", {
    operation,
    path,
    error: error instanceof PlatformError || error instanceof FSUtil.FileSystemError ? error._tag : "Unknown",
    reason:
      error instanceof PlatformError
        ? error.reason._tag
        : error instanceof FSUtil.FileSystemError
          ? error.method
          : undefined,
  }).pipe(Effect.andThen(Effect.fail(new HttpApiError.InternalServerError({}))))
}

function invalid(reason: string) {
  return new SecondBrainInvalidError({ name: "SecondBrainInvalidError", data: { message: reason } })
}

function conflict(reason: string) {
  return new SecondBrainConflictError({ name: "SecondBrainConflictError", data: { message: reason } })
}
