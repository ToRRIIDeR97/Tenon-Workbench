import { Location } from "@tenon/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const ComputerUseState = Schema.Struct({
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  permissions: Schema.Literals(["granted", "missing", "unknown"]),
  grants: Schema.optional(Schema.Struct({ accessibility: Schema.Boolean, screen: Schema.Boolean })),
  platform: Schema.String,
  /** Threads in this Project that the last Stop ended, shown on the card for a few minutes. */
  stopped: Schema.optional(Schema.Number),
}).annotate({ identifier: "ComputerUse.State" })

export const ComputerUseGroup = HttpApiGroup.make("server.computerUse")
  .add(
    HttpApiEndpoint.get("computerUse.get", "/api/computer-use", {
      query: LocationQuery,
      success: Location.response(ComputerUseState),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.computerUse.get",
          summary: "Computer use for a Project folder",
          description:
            "Whether the location folder has computer use on, and whether the Cua Driver is installed and allowed.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("computerUse.set", "/api/computer-use", {
      query: LocationQuery,
      payload: Schema.Struct({ enabled: Schema.Boolean }),
      success: Location.response(ComputerUseState),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.computerUse.set",
          summary: "Switch computer use for a Project folder",
          description:
            "Saves the choice in computer-use.json in the Tenon config folder. Threads in the folder started afterwards get the Cua Driver MCP server, except harnesses with their own computer use.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "computer use", description: "Computer use through the Cua Driver." }))
