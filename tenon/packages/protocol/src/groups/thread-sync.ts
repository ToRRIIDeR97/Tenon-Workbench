import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

const root = "/api/thread-sync"

export const ThreadSyncCode = Schema.Literals([
  "invalid_key",
  "invalid_segment",
  "unreadable",
  "invalid_name",
  "conflict",
  "unauthorized",
  "unavailable",
  "not_found",
  "not_owner",
  "diverged",
  "foreign_path",
  "unsupported",
  "not_ready",
])
export type ThreadSyncCode = typeof ThreadSyncCode.Type

const failure = { code: ThreadSyncCode, message: Schema.String }

export class ThreadSyncInvalidError extends Schema.TaggedError<ThreadSyncInvalidError>()(
  "ThreadSyncInvalidError",
  failure,
  { httpApiStatus: 400 },
) {}

export class ThreadSyncNotFoundError extends Schema.TaggedError<ThreadSyncNotFoundError>()(
  "ThreadSyncNotFoundError",
  failure,
  { httpApiStatus: 404 },
) {}

export class ThreadSyncConflictError extends Schema.TaggedError<ThreadSyncConflictError>()(
  "ThreadSyncConflictError",
  failure,
  { httpApiStatus: 409 },
) {}

export class ThreadSyncNotReadyError extends Schema.TaggedError<ThreadSyncNotReadyError>()(
  "ThreadSyncNotReadyError",
  failure,
  { httpApiStatus: 412 },
) {}

export class ThreadSyncUnprocessableError extends Schema.TaggedError<ThreadSyncUnprocessableError>()(
  "ThreadSyncUnprocessableError",
  failure,
  { httpApiStatus: 422 },
) {}

export class ThreadSyncStoreError extends Schema.TaggedError<ThreadSyncStoreError>()("ThreadSyncStoreError", failure, {
  httpApiStatus: 502,
}) {}

export const ThreadSyncError = [
  ThreadSyncInvalidError,
  ThreadSyncNotFoundError,
  ThreadSyncConflictError,
  ThreadSyncNotReadyError,
  ThreadSyncUnprocessableError,
  ThreadSyncStoreError,
] as const

export type ThreadSyncFailure = InstanceType<(typeof ThreadSyncError)[number]>

const errorFor = {
  invalid_name: ThreadSyncInvalidError,
  not_found: ThreadSyncNotFoundError,
  conflict: ThreadSyncConflictError,
  not_owner: ThreadSyncConflictError,
  diverged: ThreadSyncConflictError,
  not_ready: ThreadSyncNotReadyError,
  invalid_key: ThreadSyncUnprocessableError,
  invalid_segment: ThreadSyncUnprocessableError,
  unreadable: ThreadSyncUnprocessableError,
  unsupported: ThreadSyncUnprocessableError,
  foreign_path: ThreadSyncUnprocessableError,
  unavailable: ThreadSyncStoreError,
  unauthorized: ThreadSyncStoreError,
} satisfies Record<ThreadSyncCode, (typeof ThreadSyncError)[number]>

export function threadSyncFailure(error: { code: ThreadSyncCode; message: string }): ThreadSyncFailure {
  return new errorFor[error.code]({ code: error.code, message: error.message })
}

export const ThreadSyncStatus = Schema.Struct({
  ready: Schema.Boolean,
  enabled: Schema.Boolean,
  driveFolder: Schema.String,
  machine: Schema.Struct({ id: Schema.String, name: Schema.String }),
  missing: Schema.Array(Schema.Literals(["key", "store"])),
  lastError: Schema.NullOr(Schema.String),
}).annotate({ identifier: "ThreadSync.Status" })

export const ThreadSyncThread = Schema.Struct({
  sessionID: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  head: Schema.Number,
  updatedAt: Schema.Number,
  owner: Schema.Struct({ id: Schema.String, name: Schema.String }),
  mine: Schema.Boolean,
  local: Schema.Literals(["absent", "behind", "current", "ahead", "diverged"]),
  folder: Schema.NullOr(Schema.String),
}).annotate({ identifier: "ThreadSync.Thread" })

const Pushed = Schema.Struct({ uploaded: Schema.Number, head: Schema.Number }).annotate({
  identifier: "ThreadSync.Pushed",
})
const Pulled = Schema.Struct({ applied: Schema.Number, head: Schema.Number }).annotate({
  identifier: "ThreadSync.Pulled",
})
const params = { sessionID: Schema.String }

export const ThreadSyncGroup = HttpApiGroup.make("server.threadSync")
  .add(
    HttpApiEndpoint.get("threadSync.status", root, { success: ThreadSyncStatus }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.threadSync.status",
        summary: "Thread sync status",
        description:
          "Whether thread sync is on, the name of its Google Drive folder, this computer's name, and what is still missing.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("threadSync.configure", root, {
      payload: Schema.Struct({
        enabled: Schema.optional(Schema.Boolean),
        driveFolder: Schema.optional(Schema.String),
        machineName: Schema.optional(Schema.String),
      }),
      success: ThreadSyncStatus,
      error: ThreadSyncError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.threadSync.configure",
        summary: "Change thread sync settings",
        description:
          "Saves the choices in thread-sync.json in the Tenon config folder. The file never holds the key or a token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("threadSync.threads", `${root}/threads`, {
      success: Schema.Array(ThreadSyncThread),
      error: ThreadSyncError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.threadSync.threads",
        summary: "Stored threads",
        description: "Every thread in the sync store, newest first, with how this computer's copy compares.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("threadSync.push", `${root}/threads/:sessionID/push`, {
      params,
      success: Pushed,
      error: ThreadSyncError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.threadSync.push", summary: "Upload a thread" })),
  )
  .add(
    HttpApiEndpoint.post("threadSync.pull", `${root}/threads/:sessionID/pull`, {
      params,
      success: Pulled,
      error: ThreadSyncError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.threadSync.pull", summary: "Download a thread" })),
  )
  .add(
    HttpApiEndpoint.post("threadSync.continue", `${root}/threads/:sessionID/continue`, {
      params,
      payload: Schema.Struct({ directory: Schema.String }),
      success: Pulled,
      error: ThreadSyncError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.threadSync.continue",
        summary: "Continue a thread on this computer",
        description: "Takes the thread over and runs it in the given folder on this computer only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("threadSync.remove", `${root}/threads/:sessionID`, {
      params,
      success: HttpApiSchema.NoContent,
      error: ThreadSyncError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.threadSync.remove",
        summary: "Delete a stored thread",
        description: "Deletes the copy in the sync store. The thread on this computer stays.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "thread sync", description: "Encrypted thread sync between computers." }))
