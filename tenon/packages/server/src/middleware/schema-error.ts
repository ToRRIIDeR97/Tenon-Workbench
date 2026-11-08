import { Effect } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@tenon/protocol/errors"
import { issueSummary, SchemaErrorMiddleware } from "@tenon/protocol/middleware/schema-error"
export { SchemaErrorMiddleware } from "@tenon/protocol/middleware/schema-error"

const REASON_LIMIT = 1024

function truncateReason(reason: string) {
  if (reason.length <= REASON_LIMIT) return reason
  return reason.slice(0, REASON_LIMIT) + `... (${reason.length - REASON_LIMIT} more chars)`
}

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(SchemaErrorMiddleware, (error) => {
  const reason = truncateReason(error.cause.message)
  // The reason echoes the rejected value back to its own caller; the log keeps only tags and paths.
  return Effect.logWarning("schema rejection").pipe(
    Effect.annotateLogs({ kind: error.kind, issues: issueSummary(error.cause.issue) }),
    Effect.andThen(Effect.fail(new InvalidRequestError({ message: reason, kind: error.kind }))),
  )
})
