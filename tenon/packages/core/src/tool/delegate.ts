export * as DelegateTool from "./delegate"

import { ToolFailure } from "@tenon/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { HarnessDelegation } from "../harness/delegation"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

const wait = Schema.optional(Schema.Number.annotate({ description: "Seconds to wait for the result." }))

const task = {
  agent: Schema.String.annotate({ description: "Agent ID from list_agents." }),
  task: Schema.String.annotate({ description: "Complete instructions for the delegated agent." }),
  model: Schema.optional(Schema.String.annotate({ description: "Model ID from list_agents." })),
  reasoning_effort: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  wait_seconds: wait,
}

// The in-process loop gets the same tools that external harnesses reach over MCP.
const inputs = {
  list_agents: Schema.Struct({}),
  delegate_task: Schema.Struct(task),
  delegate_to_project: Schema.Struct({
    project_id: Schema.String.annotate({ description: "Project ID from threads_overview's projects." }),
    ...task,
  }),
  task_result: Schema.Struct({ task_id: Schema.String, wait_seconds: wait }),
  cancel_task: Schema.Struct({ task_id: Schema.String }),
  message_task: Schema.Struct({
    task_id: Schema.String,
    text: Schema.String.annotate({ description: "What the agent should change or know." }),
  }),
}

const Output = Schema.Struct({ output: Schema.String })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register(
        Object.fromEntries(
          HarnessDelegation.TOOLS.map((tool) => [
            tool.name,
            Tool.make({
              description: tool.description,
              input: inputs[tool.name],
              output: Output,
              toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
              execute: (input, context) =>
                Effect.gen(function* () {
                  // Listing is free; starting or stopping another agent's work is asked like any other tool.
                  if (tool.name !== "list_agents" && tool.name !== "task_result")
                    yield* permission.assert({
                      action: "delegate",
                      // A task placed in a Project names it, so the approval says where the work will run.
                      resources: [
                        "agent" in input ? input.agent : "*",
                        ...("project_id" in input && input.project_id ? [`project:${input.project_id}`] : []),
                      ],
                      save: ["*"],
                      metadata: { tool: tool.name, ...input },
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                    })
                  const result = yield* Effect.tryPromise({
                    try: () => HarnessDelegation.invoke(tool.name, input, context.sessionID),
                    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
                  })
                  return { output: JSON.stringify(result, null, 2) }
                }).pipe(
                  Tool.mapError(
                    (error) =>
                      new ToolFailure({ message: error instanceof Error ? error.message : "Delegation failed" }),
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
  name: "tool/delegate",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node],
})
