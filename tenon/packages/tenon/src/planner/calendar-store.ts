export * as PlannerCalendarStore from "./calendar-store"

import { FileMutation } from "@tenon/core/file-mutation"
import { FSUtil } from "@tenon/core/fs-util"
import { LocationMutation } from "@tenon/core/location-mutation"
import { Effect, Schema } from "effect"
import { rmdir } from "node:fs/promises"
import path from "node:path"
import { BrainProject } from "../project/brain"
import { PlannerCalendar } from "./calendar"

/** The workspace calendar file, read and saved with the workspace's Location services. */
export const CALENDAR_PATH = ".tenon/calendar-v1.json"
// Where earlier builds kept the calendar; the first read moves it into `.tenon`.
const LEGACY_CALENDAR_PATH = ".second-brain/calendar-v1.json"
const CALENDAR_LIMIT = 16 * 1024 * 1024

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("PlannerCalendarStore.ConflictError", {
  reason: Schema.String,
}) {}

export const read = Effect.fn("PlannerCalendarStore.read")(function* () {
  return yield* decodeCalendar((yield* calendarFile()).bytes)
})

/** Read the calendar bytes; only a missing file reads as absent, so permission errors are not an empty calendar. */
const calendarFile = Effect.fn("PlannerCalendarStore.calendarFile")(function* () {
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const target = yield* mutation.resolve({ path: CALENDAR_PATH, kind: "file" })
  yield* migrateCalendar(target)
  // Refuse an oversized calendar before reading it; "too_large" is not moved aside by a save.
  const stat = yield* fs
    .stat(target.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (stat && Number(stat.size) > CALENDAR_LIMIT)
    return yield* new PlannerCalendar.InvalidError({ reason: "too_large" })
  const bytes = yield* fs
    .readFile(target.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  return { target, bytes }
})

/**
 * Move a calendar from `.second-brain` into `.tenon` when only the old file exists: write the new file,
 * then remove the old one and its folder if that is now empty. With both present the new one wins and
 * the old one is left alone. The bytes move as they are, so a damaged file is still moved aside on save.
 */
const migrateCalendar = Effect.fn("PlannerCalendarStore.migrateCalendar")(function* (target: LocationMutation.Target) {
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const files = yield* FileMutation.Service
  if (yield* fs.existsSafe(target.canonical)) return
  const legacy = yield* mutation.resolve({ path: LEGACY_CALENDAR_PATH, kind: "file" })
  const bytes = yield* fs
    .readFile(legacy.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (!bytes) return
  // A concurrent read may have moved it first; its copy holds the same bytes.
  yield* files
    .create({ target, content: bytes })
    .pipe(Effect.catchTag("FileMutation.TargetExistsError", () => Effect.void))
  // A concurrent move may have removed it already; FileMutation.remove treats a missing file as done.
  yield* files.remove({ target: legacy })
  // rmdir removes the folder only when it is empty; anything else left there keeps it.
  yield* Effect.tryPromise(() => rmdir(path.dirname(legacy.canonical))).pipe(Effect.ignore)
  yield* Effect.logInfo("Moved the Second Brain calendar into .tenon")
})

const decodeCalendar = (bytes: Uint8Array | undefined) =>
  Effect.try({
    // The default decoder drops a leading BOM, which JSON.parse would reject.
    try: () => PlannerCalendar.decode(bytes && new TextDecoder().decode(bytes)),
    catch: (error) =>
      error instanceof PlannerCalendar.InvalidError
        ? error
        : new PlannerCalendar.InvalidError({ reason: "invalid_document" }),
  })

/**
 * Compare-and-swap the whole calendar, then mirror it into Project timelines.
 * An undecodable calendar file is moved aside to `calendar-v1.json.corrupt-<time>`
 * and replaced, so a damaged file cannot block every later save.
 */
export const save = Effect.fn("PlannerCalendarStore.save")(function* (input: PlannerCalendar.WriteInput) {
  const fs = yield* FSUtil.Service
  const files = yield* FileMutation.Service
  const file = yield* calendarFile()
  // Validate the new calendar before touching a damaged file.
  const next = yield* Effect.try({
    try: () => PlannerCalendar.encode(input.events, input.tasks),
    catch: (error) =>
      error instanceof PlannerCalendar.InvalidError
        ? error
        : new PlannerCalendar.InvalidError({ reason: "invalid_document" }),
  })
  // Reads refuse a file above the limit, so a save must not produce one.
  if (Buffer.byteLength(next.source, "utf8") > CALENDAR_LIMIT)
    return yield* new PlannerCalendar.InvalidError({ reason: "too_large" })
  const current = yield* decodeCalendar(file.bytes).pipe(
    Effect.catchIf(
      // Only a file that is not a calendar document at all is moved aside; a document
      // that parses but fails validation (for example too_many_events) still fails the save.
      (error) => error.reason === "invalid_json" || error.reason === "invalid_document",
      (error) =>
        Effect.gen(function* () {
          yield* fs.rename(file.target.canonical, `${file.target.canonical}.corrupt-${Date.now()}`)
          yield* Effect.logWarning("Moved an undecodable Second Brain calendar aside", {
            path: CALENDAR_PATH,
            reason: error.reason,
          })
          return undefined
        }),
    ),
  )
  if (current && input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    return yield* new ConflictError({ reason: "stale" })
  }
  yield* current === undefined || file.bytes === undefined
    ? files
        .create({ target: file.target, content: next.source })
        .pipe(
          Effect.catchTag("FileMutation.TargetExistsError", () => Effect.fail(new ConflictError({ reason: "stale" }))),
        )
    : files
        .writeIfUnchanged({ target: file.target, content: next.source, expected: file.bytes })
        .pipe(
          Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(new ConflictError({ reason: "stale" }))),
        )
  const snapshot = { version: next.version, revision: next.revision, events: next.events, tasks: next.tasks }
  yield* BrainProject.syncTimelines(snapshot, current).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Second Brain project timeline sync failed; project timelines may be stale", {
        error: error._tag,
      }),
    ),
  )
  return snapshot
})
