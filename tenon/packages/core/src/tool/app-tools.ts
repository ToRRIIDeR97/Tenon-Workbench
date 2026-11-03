export * as AppToolsTool from "./app-tools"

import { ToolFailure } from "@tenon/llm"
import { Effect, type JsonSchema, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { HarnessAppTools } from "../harness/app-tools"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

/** Permission action asked before an app tool changes Tenon data (notes, timeline, log, calendar, tasks). */
export const WRITE_PERMISSION = "tenon_write"

const Input = Schema.Record(Schema.String, Schema.Unknown)
const Output = Schema.Struct({ output: Schema.String })

/**
 * The in-process loop gets the same Tenon app tools that external harnesses reach over the `tenon` MCP
 * server. They are registered when a folder's services start, from the installed provider's catalog;
 * each call is still routed through `HarnessAppTools.call`, which applies the caller's own tool list
 * (Project scoping lives in the provider). Writes ask permission `tenon_write`; reads do not.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const location = yield* Location.Service
    // Some tools exist only in some folders (the Command Centre's), so the catalog is per folder.
    const catalog = HarnessAppTools.catalog(location.directory)
    if (catalog.length === 0) return

    yield* tools
      .register(
        Object.fromEntries(
          catalog.map((tool) => [
            tool.name,
            Tool.make({
              description: tool.description,
              input: Input,
              inputJsonSchema: tool.inputSchema as JsonSchema.JsonSchema,
              output: Output,
              toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
              execute: (input, context) =>
                Effect.gen(function* () {
                  if (!tool.annotations?.readOnlyHint)
                    yield* permission.assert({
                      action: WRITE_PERMISSION,
                      resources: [tool.name],
                      save: ["*"],
                      metadata: { tool: tool.name, ...input },
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                    })
                  const result = yield* Effect.tryPromise({
                    try: () =>
                      HarnessAppTools.call(tool.name, input, {
                        sessionID: context.sessionID,
                        messageID: context.assistantMessageID,
                        callID: context.toolCallID,
                      }),
                    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
                  })
                  if (!result) return yield* Effect.fail(new Error(`${tool.name} is not available for this thread.`))
                  return {
                    output: typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2),
                  }
                }).pipe(
                  Tool.mapError(
                    (error) => new ToolFailure({ message: error instanceof Error ? error.message : "App tool failed" }),
                  ),
                ),
            }),
          ]),
        ),
      )
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/app-tools",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, Location.node],
})
