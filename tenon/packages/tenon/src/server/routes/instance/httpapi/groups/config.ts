import { Config } from "@/config/config"
import { ConfigV1 } from "@tenon/core/v1/config/config"
import { Provider } from "@/provider/provider"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/http-api"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/config"

const TrustStatus = Schema.Struct({
  root: Schema.String,
  trusted: Schema.Boolean,
  withheld: Schema.Array(Schema.String),
}).annotate({ identifier: "ConfigTrustStatus" })

export const ConfigApi = HttpApi.make("config")
  .add(
    HttpApiGroup.make("config")
      .add(
        HttpApiEndpoint.get("get", root, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigV1.Info, "Get config info"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.get",
            summary: "Get configuration",
            description: "Retrieve the current Tenon configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.patch("update", root, {
          query: WorkspaceRoutingQuery,
          payload: ConfigV1.Info,
          success: described(ConfigV1.Info, "Successfully updated config"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.update",
            summary: "Update configuration",
            description: "Update Tenon configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.get("providers", `${root}/providers`, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ConfigProvidersResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.providers",
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
          }),
        ),
        HttpApiEndpoint.get("trust", `${root}/trust`, {
          query: WorkspaceRoutingQuery,
          success: described(TrustStatus, "Trust status of the folder"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.trust",
            summary: "Get folder trust",
            description: "Whether this folder is approved, and what its config asks for that stays off until it is.",
          }),
        ),
        HttpApiEndpoint.post("approveFolder", `${root}/trust`, {
          query: WorkspaceRoutingQuery,
          success: described(TrustStatus, "The folder was approved"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.approveFolder",
            summary: "Approve this folder",
            description: "Add this folder to the trusted list and reload it, so its project config takes effect.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "config",
          description: "Experimental HttpApi config routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Tenon experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
