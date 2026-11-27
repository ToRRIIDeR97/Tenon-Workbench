import { eq } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { Database } from "../database/database"
import { KeyedMutex } from "../effect/keyed-mutex"
import type { EventV2 } from "../event"
import { ProjectSchema } from "../project/schema"
import { ProjectTable } from "../project/sql"
import { AbsolutePath } from "../schema"
import { SessionSchema } from "../session/schema"
import { SessionTable } from "../session/sql"
import { isKey } from "./crypto"
import { make } from "./engine"
import { syncError } from "./error"
import type { SyncError } from "./error"
import { canHold } from "./local-path"
import { folderOf, isBucket, isMachineName, loadSettings, saveSettings, withFolder } from "./settings"
import type { Settings } from "./settings"
import type { Store } from "./store"

export type Missing = "bucket" | "key" | "store"
export type LocalState = "absent" | "behind" | "current" | "ahead" | "diverged"

export type Status = {
  ready: boolean
  enabled: boolean
  bucket: string
  machine: { id: string; name: string }
  missing: Missing[]
  lastError: string | null
}

export type StoredThread = {
  sessionID: string
  title: string
  directory: string
  head: number
  updatedAt: number
  owner: { id: string; name: string }
  mine: boolean
  local: LocalState
  folder: string | null
}

export type Credentials = {
  key(): Promise<Uint8Array | undefined>
  store(bucket: string): Promise<Store | undefined>
}

export type Projects = {
  resolve(directory: string): Promise<{ id: string; worktree: string }>
}

const QUIET = new Set(["not_ready", "not_owner", "not_found", "invalid_name"])

export function manager(input: {
  db: Database.Interface["db"]
  events: EventV2.Interface
  settingsFile: string
  credentials: Credentials
  projects: Projects
  hostname: string
  platform?: NodeJS.Platform
}) {
  const threadLock = KeyedMutex.makeUnsafe<string>()
  const settingsLock = Semaphore.makeUnsafe(1)
  const state: { settings?: Promise<Settings>; lastError: string | null } = { lastError: null }

  const settings = Effect.promise(() => (state.settings ??= loadSettings(input.settingsFile, input.hostname)))

  const update = (change: (current: Settings) => Settings) =>
    settingsLock.withPermit(
      Effect.gen(function* () {
        const next = change(yield* settings)
        yield* Effect.tryPromise({
          try: () => saveSettings(input.settingsFile, next),
          catch: () => syncError("unavailable", "The sync settings could not be saved"),
        })
        state.settings = Promise.resolve(next)
        return next
      }),
    )

  const credentials = (current: Settings) =>
    Effect.promise(async () => {
      const key = await input.credentials.key().then(
        (found) => (found && isKey(found) ? found : undefined),
        () => undefined,
      )
      const store = current.bucket ? await input.credentials.store(current.bucket).catch(() => undefined) : undefined
      const missing: Missing[] = [
        ...(current.bucket ? [] : ["bucket" as const]),
        ...(key ? [] : ["key" as const]),
        ...(store ? [] : ["store" as const]),
      ]
      return { key, store, missing }
    })

  const status = () =>
    Effect.gen(function* () {
      const current = yield* settings
      const found = yield* credentials(current)
      return {
        ready: current.enabled && found.missing.length === 0,
        enabled: current.enabled,
        bucket: current.bucket,
        machine: { id: current.machine.id, name: current.machine.name },
        missing: found.missing,
        lastError: state.lastError,
      } satisfies Status
    })

  const ready = Effect.gen(function* () {
    const current = yield* settings
    if (!current.enabled) return yield* Effect.fail(syncError("not_ready", "Thread sync is off"))
    const found = yield* credentials(current)
    if (!found.key || !found.store)
      return yield* Effect.fail(syncError("not_ready", `Thread sync is missing: ${found.missing.join(", ")}`))
    return {
      settings: current,
      engine: make({
        db: input.db,
        events: input.events,
        store: found.store,
        key: found.key,
        machine: current.machine,
      }),
    }
  })

  const resolveProject = (directory: string) =>
    Effect.tryPromise({
      try: () => input.projects.resolve(directory),
      catch: () => syncError("invalid_name", "This folder cannot hold the thread"),
    }).pipe(
      Effect.filterOrFail(
        (project) => project.id !== "" && isFolder(project.worktree, input.platform),
        () => syncError("invalid_name", "This folder cannot hold the thread"),
      ),
    )

  const writeFolder = (sessionID: string, directory: string, project: { id: string; worktree: string }) =>
    input.db
      .transaction(
        () =>
          Effect.gen(function* () {
            const projectID = ProjectSchema.ID.make(project.id)
            yield* input.db
              .insert(ProjectTable)
              .values({ id: projectID, worktree: AbsolutePath.make(project.worktree), sandboxes: [] })
              .onConflictDoNothing()
              .run()
            yield* input.db
              .update(SessionTable)
              .set({ directory, project_id: projectID })
              .where(eq(SessionTable.id, SessionSchema.ID.make(sessionID)))
              .run()
          }),
        { behavior: "immediate" },
      )
      .pipe(Effect.orDie)

  const placeFolder = (sessionID: string) =>
    Effect.gen(function* () {
      const folder = folderOf(yield* settings, sessionID)
      if (folder === null) return
      yield* writeFolder(sessionID, folder, yield* resolveProject(folder))
    })

  const configure = (change: { enabled?: boolean; bucket?: string; machineName?: string }) =>
    Effect.gen(function* () {
      if (change.bucket !== undefined && !isBucket(change.bucket))
        return yield* Effect.fail(
          syncError("invalid_name", "A bucket name is 3 to 63 lower-case letters, digits, dots, dashes or underscores"),
        )
      const name = change.machineName?.trim()
      if (name !== undefined && !isMachineName(name))
        return yield* Effect.fail(syncError("invalid_name", "A computer name is 1 to 64 characters"))
      yield* update((current) => ({
        ...current,
        enabled: change.enabled ?? current.enabled,
        bucket: change.bucket ?? current.bucket,
        machine: { id: current.machine.id, name: name ?? current.machine.name },
      }))
      return yield* status()
    })

  const threads = () =>
    Effect.gen(function* () {
      const sync = yield* ready
      const stored = yield* sync.engine.list()
      return yield* Effect.forEach(stored, (thread) =>
        sync.engine.compare(thread.sessionID).pipe(
          Effect.map(
            (local): StoredThread => ({
              sessionID: thread.sessionID,
              title: thread.title,
              directory: thread.directory,
              head: thread.head,
              updatedAt: thread.updatedAt,
              owner: thread.owner,
              mine: thread.owner.id === sync.settings.machine.id,
              local,
              folder: folderOf(sync.settings, thread.sessionID),
            }),
          ),
        ),
      )
    })

  const push = (sessionID: string) =>
    threadLock.withLock(sessionID)(
      Effect.gen(function* () {
        const sync = yield* ready
        const pushed = yield* sync.engine.push(sessionID)
        state.lastError = null
        return pushed
      }),
    )

  const pull = (sessionID: string) =>
    threadLock.withLock(sessionID)(
      Effect.gen(function* () {
        const sync = yield* ready
        const pulled = yield* sync.engine.pull(sessionID)
        yield* placeFolder(sessionID)
        return pulled
      }),
    )

  const continueHere = (sessionID: string, place: { directory: string }) =>
    threadLock.withLock(sessionID)(
      Effect.gen(function* () {
        const sync = yield* ready
        if (!isFolder(place.directory, input.platform))
          return yield* Effect.fail(syncError("invalid_name", "A folder is an absolute path on this computer"))
        const project = yield* resolveProject(place.directory)
        const taken = yield* sync.engine.takeOver(sessionID)
        yield* update((current) => withFolder(current, sessionID, place.directory))
        yield* writeFolder(sessionID, place.directory, project)
        return taken
      }),
    )

  const settled = (sessionID: string) =>
    threadLock
      .withLock(sessionID)(
        Effect.gen(function* () {
          const sync = yield* ready
          const pushed = yield* sync.engine.push(sessionID)
          state.lastError = null
          return pushed.uploaded > 0 ? { pushed: true } : { pushed: false, reason: "up_to_date" }
        }),
      )
      .pipe(
        Effect.catch((error: SyncError) =>
          Effect.sync(() => {
            if (!QUIET.has(error.code)) state.lastError = error.message
            return { pushed: false, reason: error.code }
          }),
        ),
        Effect.catchDefect(() =>
          Effect.sync(() => {
            state.lastError = "Thread sync failed unexpectedly"
            return { pushed: false, reason: "failed" }
          }),
        ),
      ) satisfies Effect.Effect<{ pushed: boolean; reason?: string }>

  const remove = (sessionID: string) =>
    threadLock.withLock(sessionID)(
      Effect.gen(function* () {
        const sync = yield* ready
        yield* sync.engine.remove(sessionID)
      }),
    )

  return { status, configure, threads, push, pull, continueHere, settled, remove }
}

export type Manager = ReturnType<typeof manager>

function isFolder(directory: unknown, platform?: NodeJS.Platform): directory is string {
  return typeof directory === "string" && directory !== "" && canHold(directory, platform)
}
