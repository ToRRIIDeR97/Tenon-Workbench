import { GithubWork } from "@tenon/core/github/work"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const GithubHandler = HttpApiBuilder.group(Api, "server.github", (handlers) =>
  handlers.handle("github.work", (ctx) => response(GithubWork.forLocation(ctx.payload)).pipe(Effect.orDie)),
)
