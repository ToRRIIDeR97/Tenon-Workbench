import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { issueSummary } from "@tenon/protocol/middleware/schema-error"
import { InvalidRequestError } from "../errors"

// Effect's Issue formatter recursively dumps the rejected `actual` value with
// no truncation, so a 5KB invalid array produces a ~360KB string. Cap to keep
// 4xx responses small. The reason goes back only to the caller that sent the
// payload; the log keeps issue tags and paths, never the rejected value.
const REASON_LIMIT = 1024
function truncateReason(reason: string) {
  if (reason.length <= REASON_LIMIT) return reason
  return reason.slice(0, REASON_LIMIT) + `… (${reason.length - REASON_LIMIT} more chars)`
}

// Default Respondable returns an empty 400 body. Match the NamedError shape
// used by other 4xx/5xx so the SDK's `wrapClientError` extracts `.data.message`.
export class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "@tenon/HttpApiSchemaError",
  {
    error: InvalidRequestError,
  },
) {}

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(SchemaErrorMiddleware, (error, context) => {
  const reason = truncateReason(error.cause.message)
  const response = context.endpoint.path.startsWith("/api/")
    ? Effect.fail(
        new InvalidRequestError({
          message: reason,
          kind: error.kind,
        }),
      )
    : Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { name: "BadRequest", data: { message: reason, kind: error.kind } },
          { status: 400 },
        ),
      )
  return Effect.logWarning("schema rejection", { kind: error.kind, issues: issueSummary(error.cause.issue) }).pipe(
    Effect.andThen(response),
  )
})
