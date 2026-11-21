import { FileSystem } from "@tenon/core/filesystem"
import { RelativePath } from "@tenon/core/schema"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handleRaw("fs.read", (ctx) =>
        Effect.gen(function* () {
          const decoded = yield* Effect.try({
            try: () => decodeURIComponent(new URL(ctx.request.url, "http://localhost").pathname.slice(13)),
            catch: () => "invalid_uri" as const,
          }).pipe(Effect.option)
          if (decoded._tag === "None") {
            return HttpServerResponse.text("Invalid path encoding", { status: 400 })
          }
          const file = yield* (yield* FileSystem.Service).read({
            path: RelativePath.make(decoded.value),
          })
          return HttpServerResponse.uint8Array(file.content, {
            contentType: file.mime,
            headers: {
              "x-content-type-options": "nosniff",
              "content-security-policy": "default-src 'none'; sandbox",
              "content-disposition": "attachment",
            },
          })
        }),
      )
      .handle("fs.list", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.list(ctx.query)
          }),
        ),
      )
      .handle("fs.find", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.find(ctx.query)
          }),
        ),
      )
  }),
)
