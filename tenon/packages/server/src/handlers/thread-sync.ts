import { ThreadSync } from "@tenon/core/thread-sync"
import { threadSyncFailure } from "@tenon/protocol/groups/thread-sync"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"

const answer = <A, R>(effect: Effect.Effect<A, ThreadSync.SyncError, R>) =>
  effect.pipe(Effect.mapError(threadSyncFailure))

export const ThreadSyncHandler = HttpApiBuilder.group(Api, "server.threadSync", (handlers) =>
  handlers
    .handle("threadSync.status", () => ThreadSync.Service.use((sync) => sync.status()))
    .handle("threadSync.configure", (ctx) => ThreadSync.Service.use((sync) => answer(sync.configure(ctx.payload))))
    .handle("threadSync.threads", () => ThreadSync.Service.use((sync) => answer(sync.threads())))
    .handle("threadSync.push", (ctx) => ThreadSync.Service.use((sync) => answer(sync.push(ctx.params.sessionID))))
    .handle("threadSync.pull", (ctx) => ThreadSync.Service.use((sync) => answer(sync.pull(ctx.params.sessionID))))
    .handle("threadSync.continue", (ctx) =>
      ThreadSync.Service.use((sync) => answer(sync.continueHere(ctx.params.sessionID, ctx.payload))),
    )
    .handle("threadSync.remove", (ctx) =>
      ThreadSync.Service.use((sync) =>
        answer(sync.remove(ctx.params.sessionID)).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      ),
    ),
)
