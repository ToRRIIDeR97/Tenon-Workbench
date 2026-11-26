import { Schema } from "effect"

export const Code = Schema.Literals([
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
])
export type Code = typeof Code.Type

export class SyncError extends Schema.TaggedError<SyncError>()("ThreadSync.SyncError", {
  code: Code,
  message: Schema.String,
}) {}

export const syncError = (code: Code, message: string) => new SyncError({ code, message })

export const asSyncError = (cause: unknown) =>
  cause instanceof SyncError ? cause : syncError("unavailable", "The sync store could not be reached")
