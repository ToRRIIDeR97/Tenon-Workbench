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

export const WRITE_PERMISSION = "tenon_write"

const Input = Schema.Record(Schema.String, Schema.Unknown)
const Output = Schema.Struct({ output: Schema.String })

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const location = yield* Location.Service
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
                  const asked = tool.permission && input[tool.permission.field]
                  if (!tool.annotations?.readOnlyHint)
                    yield* permission.assert({
                      action: tool.permission?.action ?? WRITE_PERMISSION,
                      resources: [typeof asked === "string" ? asked : tool.name],
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
