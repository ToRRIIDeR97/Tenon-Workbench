import { isDeepStrictEqual } from "node:util"
import { asc, eq } from "drizzle-orm"
import { Durable } from "@tenon/schema/durable-event-manifest"
import { Effect, Option, Schema } from "effect"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { EventSequenceTable, EventTable } from "../event/sql"
import type { ProjectSchema } from "../project/schema"
import { ProjectTable } from "../project/sql"
import { AbsolutePath } from "../schema"
import type { SessionSchema } from "../session/schema"
import { SessionTable } from "../session/sql"
import { decrypt, encrypt, isKey, manifestContext, open, seal } from "./crypto"
import { SyncError, asSyncError, syncError } from "./error"
import { canHold } from "./local-path"
import { isPart } from "./store"
import type { Store } from "./store"

const MANIFEST_VERSION = 1

const Manifest = Schema.Struct({
  version: Schema.Literal(MANIFEST_VERSION),
  sessionID: Schema.String,
  owner: Schema.Struct({ id: Schema.String, name: Schema.String }),
  head: Schema.Number,
  updatedAt: Schema.Number,
  directory: Schema.String,
  title: Schema.String,
  project: Schema.NullOr(Schema.Struct({ id: Schema.String, worktree: Schema.String })),
  segments: Schema.Array(
    Schema.Struct({ name: Schema.String, hash: Schema.String, first: Schema.Number, last: Schema.Number }),
  ),
})
type Manifest = typeof Manifest.Type
const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest))

export function make(input: {
  db: Database.Interface["db"]
  events: EventV2.Interface
  store: Store
  key: Uint8Array
  machine: { id: string; name: string }
}) {
  const call = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: asSyncError })
  const me = { id: input.machine.id, name: input.machine.name }

  const requireKey = Effect.suspend(() =>
    isKey(input.key) ? Effect.void : Effect.fail(syncError("invalid_key", "A sync key is 32 bytes")),
  )

  const requireThread = (sessionID: string) =>
    requireKey.pipe(
      Effect.andThen(
        isPart(sessionID) ? Effect.void : Effect.fail(syncError("invalid_name", "This is not a thread ID")),
      ),
    )

  const readManifest = (sessionID: string) =>
    Effect.gen(function* () {
      const stored = yield* call(() => input.store.get(manifestName(sessionID)))
      if (!stored) return undefined
      const text = yield* call(() => decrypt(input.key, manifestContext(sessionID), stored.bytes))
      const manifest = Option.getOrUndefined(decodeManifest(text))
      if (!manifest || manifest.sessionID !== sessionID)
        return yield* Effect.fail(syncError("unreadable", "The stored thread cannot be read"))
      return { manifest, generation: stored.generation }
    })

  const writeManifest = (manifest: Manifest, ifGeneration: string | null) =>
    call(async () =>
      input.store.put(
        manifestName(manifest.sessionID),
        await encrypt(input.key, manifestContext(manifest.sessionID), JSON.stringify(manifest)),
        { ifGeneration },
      ),
    )

  const writeSegment = (name: string, bytes: Uint8Array) =>
    input.store.put(name, bytes, { ifGeneration: null }).then(
      () => undefined,
      async (error: unknown) => {
        if (!(error instanceof SyncError) || error.code !== "conflict") throw error
        const existing = await input.store.get(name)
        if (existing && Buffer.from(existing.bytes).equals(Buffer.from(bytes))) return undefined
        throw error
      },
    )

  const readRemote = (manifest: Manifest) =>
    call(async () => {
      const segments = await Promise.all(
        manifest.segments.map(async (entry, index) => {
          const stored = await input.store.get(entry.name)
          if (!stored) throw syncError("unreadable", "A segment of the stored thread is missing")
          const segment = await open({
            key: input.key,
            sessionID: manifest.sessionID,
            previous: index === 0 ? null : manifest.segments[index - 1].hash,
            bytes: stored.bytes,
          })
          if (segment.hash !== entry.hash || segment.first !== entry.first || segment.last !== entry.last)
            throw syncError("unreadable", "A segment does not match the stored thread")
          return segment.events
        }),
      )
      const events = segments.flat()
      if (events.length !== manifest.head + 1 || !events.every((event, index) => event.seq === index))
        throw syncError("unreadable", "The stored thread has gaps")
      return events
    })

  const localEvents = (sessionID: string) =>
    input.db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) =>
          rows.map(
            (row): EventV2.SerializedEvent => ({
              id: row.id,
              aggregateID: row.aggregate_id,
              seq: row.seq,
              type: row.type,
              data: row.data,
            }),
          ),
        ),
      )

  const localOwner = (sessionID: string) =>
    input.db
      .select({ ownerID: EventSequenceTable.owner_id })
      .from(EventSequenceTable)
      .where(eq(EventSequenceTable.aggregate_id, sessionID))
      .get()
      .pipe(
        Effect.orDie,
        Effect.map((row) => row?.ownerID ?? undefined),
      )

  const describe = (sessionID: string) =>
    Effect.gen(function* () {
      const session = yield* input.db
        .select({ title: SessionTable.title, directory: SessionTable.directory, projectID: SessionTable.project_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID as SessionSchema.ID))
        .get()
        .pipe(Effect.orDie)
      if (!session) return { title: "", directory: "", project: null }
      const project = yield* input.db
        .select({ id: ProjectTable.id, worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, session.projectID))
        .get()
        .pipe(Effect.orDie)
      return {
        title: session.title,
        directory: session.directory,
        project: project ? { id: String(project.id), worktree: String(project.worktree) } : null,
      }
    })

  const apply = (sessionID: string, manifest: Manifest, events: EventV2.SerializedEvent[]) =>
    input.db
      .transaction(
        () =>
          Effect.gen(function* () {
            const owner = yield* localOwner(sessionID)
            if (manifest.project)
              yield* input.db
                .insert(ProjectTable)
                .values({
                  id: manifest.project.id as ProjectSchema.ID,
                  worktree: AbsolutePath.make(manifest.project.worktree),
                  sandboxes: [],
                })
                .onConflictDoNothing()
                .run()
                .pipe(Effect.orDie)
            yield* input.events.replayAll(events, owner ? { ownerID: owner } : {})
            yield* input.events.claim(sessionID, manifest.owner.id)
          }),
        { behavior: "immediate" },
      )
      .pipe(
        Effect.orDie,
        Effect.catchDefect(() => Effect.fail(syncError("unsupported", "This computer cannot apply the stored thread"))),
      )

  const fetchAndApply = (sessionID: string) =>
    Effect.gen(function* () {
      yield* requireThread(sessionID)
      const current = yield* readManifest(sessionID)
      if (!current) return yield* Effect.fail(syncError("not_found", "This thread is not in the sync store"))
      if (!canHold(current.manifest.directory) || !canHold(current.manifest.project?.worktree ?? ""))
        return yield* Effect.fail(syncError("foreign_path", "This thread's folder is a path this computer cannot hold"))
      const remote = yield* readRemote(current.manifest)
      const local = yield* localEvents(sessionID)
      if (local.some((event) => differs(event, remote[event.seq])))
        return yield* Effect.fail(syncError("diverged", "This computer's copy of the thread has a different history"))
      const latest = local.at(-1)?.seq ?? -1
      const missing = remote.filter((event) => event.seq > latest)
      if (!missing.every((event) => applicable(event, sessionID)))
        return yield* Effect.fail(syncError("unsupported", "The stored thread holds events this version cannot apply"))
      if (missing.length > 0) yield* apply(sessionID, current.manifest, missing)
      if (missing.length === 0 && local.length > 0 && current.manifest.head >= latest)
        yield* input.events.claim(sessionID, current.manifest.owner.id)
      return { applied: missing.length, head: current.manifest.head, current }
    })

  const push = Effect.fn("ThreadSync.push")(function* (sessionID: string) {
    yield* requireThread(sessionID)
    const local = yield* localEvents(sessionID)
    if (local.length === 0) return yield* Effect.fail(syncError("not_found", "This thread has no local events"))
    const current = yield* readManifest(sessionID)
    if (current && current.manifest.owner.id !== me.id)
      return yield* Effect.fail(syncError("not_owner", "Another computer owns this thread"))
    const head = current?.manifest.head ?? -1
    const fresh = local.filter((event) => event.seq > head)
    if (fresh.length === 0) {
      if (current) yield* input.events.claim(sessionID, me.id)
      return { uploaded: 0, head }
    }
    const sealed = yield* call(() =>
      seal({
        key: input.key,
        sessionID,
        previous: current?.manifest.segments.at(-1)?.hash ?? null,
        events: fresh,
      }),
    )
    const name = segmentName(sessionID, sealed)
    yield* call(() => writeSegment(name, sealed.bytes))
    const about = yield* describe(sessionID)
    yield* writeManifest(
      {
        version: MANIFEST_VERSION,
        sessionID,
        owner: me,
        head: sealed.last,
        updatedAt: Date.now(),
        directory: about.directory,
        title: about.title,
        project: about.project,
        segments: [
          ...(current?.manifest.segments ?? []),
          { name, hash: sealed.hash, first: sealed.first, last: sealed.last },
        ],
      },
      current?.generation ?? null,
    ).pipe(
      Effect.catch((error) =>
        readManifest(sessionID).pipe(
          Effect.catch(() => Effect.fail(error)),
          Effect.flatMap((after) => {
            if (after?.manifest.segments.some((segment) => segment.name === name)) return Effect.void
            return call(() => input.store.remove(name)).pipe(Effect.ignore, Effect.andThen(Effect.fail(error)))
          }),
        ),
      ),
    )
    yield* input.events.claim(sessionID, me.id)
    return { uploaded: fresh.length, head: sealed.last }
  })

  const pull = Effect.fn("ThreadSync.pull")(function* (sessionID: string) {
    const pulled = yield* fetchAndApply(sessionID)
    return { applied: pulled.applied, head: pulled.head }
  })

  const takeOver = Effect.fn("ThreadSync.takeOver")(function* (sessionID: string) {
    const pulled = yield* fetchAndApply(sessionID)
    if (pulled.current.manifest.owner.id === me.id) return { applied: pulled.applied, head: pulled.head }
    yield* writeManifest({ ...pulled.current.manifest, owner: me }, pulled.current.generation).pipe(
      Effect.catch((error) =>
        readManifest(sessionID).pipe(
          Effect.catch(() => Effect.fail(error)),
          Effect.flatMap((after) =>
            after?.manifest.owner.id === me.id && after.manifest.head === pulled.head
              ? Effect.void
              : Effect.fail(error),
          ),
        ),
      ),
    )
    yield* input.events.claim(sessionID, me.id)
    return { applied: pulled.applied, head: pulled.head }
  })

  const list = Effect.fn("ThreadSync.list")(function* () {
    yield* requireKey
    const stored = yield* call(() => input.store.list("threads/"))
    const sessionIDs = stored
      .map((item) => /^threads\/([^/]+)\/manifest$/.exec(item.name)?.[1])
      .filter((sessionID): sessionID is string => isPart(sessionID))
    const manifests = yield* Effect.forEach(sessionIDs, readManifest)
    return manifests
      .filter((item) => item !== undefined)
      .map((item) => ({
        sessionID: item.manifest.sessionID,
        head: item.manifest.head,
        owner: { id: item.manifest.owner.id, name: item.manifest.owner.name },
        updatedAt: item.manifest.updatedAt,
        directory: item.manifest.directory,
        title: item.manifest.title,
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt || (left.sessionID < right.sessionID ? -1 : 1))
  })

  const remove = Effect.fn("ThreadSync.remove")(function* (sessionID: string) {
    yield* requireThread(sessionID)
    const current = yield* readManifest(sessionID)
    if (!current) return yield* Effect.fail(syncError("not_found", "This thread is not in the sync store"))
    if (current.manifest.owner.id !== me.id)
      return yield* Effect.fail(syncError("not_owner", "Another computer owns this thread"))
    yield* call(() => input.store.remove(manifestName(sessionID)))
    const rest = yield* call(() => input.store.list(`threads/${sessionID}/`))
    yield* Effect.forEach(rest, (item) => call(() => input.store.remove(item.name)), { discard: true })
  })

  return { push, pull, takeOver, list, remove }
}

function manifestName(sessionID: string) {
  return `threads/${sessionID}/manifest`
}

function segmentName(sessionID: string, sealed: { first: number; last: number; hash: string }) {
  return `threads/${sessionID}/segment-${String(sealed.first).padStart(12, "0")}-${String(sealed.last).padStart(12, "0")}-${sealed.hash}`
}

function applicable(event: EventV2.SerializedEvent, sessionID: string) {
  const definition = Durable.get(event.type)
  if (!definition?.durable) return false
  const data = Option.getOrUndefined(Schema.decodeUnknownOption(definition.data)(event.data))
  if (typeof data !== "object" || data === null) return false
  return (data as Record<string, unknown>)[definition.durable.aggregate] === sessionID
}

function differs(local: EventV2.SerializedEvent, remote: EventV2.SerializedEvent | undefined) {
  if (!remote) return false
  return !(local.id === remote.id && local.type === remote.type && isDeepStrictEqual(local.data, remote.data))
}
