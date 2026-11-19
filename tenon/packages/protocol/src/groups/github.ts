import { Location } from "@tenon/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location"

const Issue = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  updatedAt: Schema.String,
  closedAt: Schema.optional(Schema.String),
  author: Schema.String,
  labels: Schema.Array(Schema.String),
})

const Pull = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["open", "merged", "closed"]),
  draft: Schema.Boolean,
  checks: Schema.optional(Schema.Literals(["passing", "failing", "pending"])),
  review: Schema.optional(Schema.Literals(["approved", "changes", "required"])),
  closes: Schema.Array(Schema.Number),
})

export const GithubWork = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ok"),
    repo: Schema.String,
    issues: Schema.Array(Issue),
    pulls: Schema.Array(Pull),
    source: Schema.optional(Schema.Literals(["origin", "project"])),
  }),
  Schema.Struct({ status: Schema.Literals(["no-repo", "no-gh", "signed-out"]) }),
  Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
]).annotate({ identifier: "Github.Work" })

export const GithubGroup = HttpApiGroup.make("server.github")
  .add(
    HttpApiEndpoint.post("github.work", "/api/github/work", {
      query: LocationQuery,
      payload: Schema.Struct({
        repo: Schema.optional(Schema.String),
        save: Schema.optional(Schema.Boolean),
        refresh: Schema.optional(Schema.Boolean),
      }),
      success: Location.response(GithubWork),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.github.work",
          summary: "List a Project's GitHub issues and pull requests",
          description:
            "Open and recently closed issues and recent pull requests of the location folder's GitHub repository (its origin, or `repo` as owner/name), read with the user's gh CLI login. No token is stored or returned.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "github", description: "GitHub work for Projects." }))
