import { NamedError } from "@tenon/core/util/error"
import { ConfigErrorV1 } from "@tenon/core/v1/config/error"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerRespondable, HttpServerResponse } from "effect/http"
import { stat } from "node:fs/promises"

const missingDirectory = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const header = request.headers["x-tenon-directory"] || request.headers["x-opencode-directory"]
  const query = new URL(request.url, "http://localhost").searchParams
  const directory =
    query.get("directory") || query.get("location[directory]") || (header ? decodeURIComponent(header) : undefined)
  if (!directory) return false
  return yield* Effect.promise(() =>
    stat(directory).then(
      (info) => !info.isDirectory(),
      () => true,
    ),
  )
}).pipe(Effect.catchCause(() => Effect.succeed(false)))

export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
          if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
          if (HttpServerError.isHttpServerError(reason.defect)) return false
          if (HttpServerRespondable.isRespondable(reason.defect)) return false
          return true
        })
        if (!defect) return yield* Effect.failCause(cause)

        const error = defect.defect
        if (
          ConfigErrorV1.JsonError.isInstance(error) ||
          ConfigErrorV1.InvalidError.isInstance(error) ||
          ConfigErrorV1.FrontmatterError.isInstance(error) ||
          ConfigErrorV1.DirectoryTypoError.isInstance(error)
        ) {
          return HttpServerResponse.jsonUnsafe(error.toObject(), { status: 400 })
        }

        if (yield* missingDirectory) {
          return HttpServerResponse.jsonUnsafe(
            { name: "WorkspaceFolderNotFoundError", data: { message: "The workspace folder was not found." } },
            { status: 404 },
          )
        }

        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        yield* Effect.logError("failed", { ref, error, cause: Cause.pretty(cause) })
        return HttpServerResponse.jsonUnsafe(
          new NamedError.Unknown({
            message: "Unexpected server error. Check server logs for details.",
            ref,
          }).toObject(),
          { status: 500 },
        )
      }),
    ),
  ),
).layer
