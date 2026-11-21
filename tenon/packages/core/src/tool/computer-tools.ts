export * as ComputerToolsTool from "./computer-tools"

import { ToolFailure } from "@tenon/llm"
import { Effect, type JsonSchema, Layer, Schedule, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { HarnessComputerProxy } from "../harness/computer-proxy"
import { HarnessComputerUse } from "../harness/computer-use"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

/** The largest screenshot kept in a tool result (about 1.5 MB of image). */
const MAX_IMAGE_BASE64 = 2_000_000

/** Permission action asked before the built-in agent clicks or types on the desktop (#333). */
export const PERMISSION = "computer_use"

const Input = Schema.Record(Schema.String, Schema.Unknown)
const Output = Schema.Struct({
  output: Schema.String,
  images: Schema.Array(Schema.Struct({ mime: Schema.String, data: Schema.String })),
})

/**
 * The built-in agent gets computer use with the same Project switch as every harness (#333, 1A): the Cua Driver's
 * tools through Tenon's proxy, registered when the folder's services start with computer use on. Clicks and typing
 * ask through a permission card (its "always" keeps the thread from asking again); the proxy refuses once the
 * Project is switched off, and Stop shuts the driver down.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const location = yield* Location.Service
    // Only a Project with computer use on lists (and so starts) the driver; switching the Project changes the folder's
    // services (the computer use route invalidates them), so this runs again without a restart.
    if (!HarnessComputerUse.findDriver()) return
    const list = Effect.promise(() =>
      HarnessComputerProxy.shared.tools({ directory: location.directory }).catch(() => []),
    )
    const register = (listed: Awaited<ReturnType<typeof HarnessComputerProxy.shared.tools>>) =>
      tools
        .register(
          Object.fromEntries(
            listed.map((tool) => [
              `computer_${tool.name}`,
              Tool.make({
                description: tool.description ?? tool.name,
                input: Input,
                inputJsonSchema: tool.inputSchema as JsonSchema.JsonSchema,
                output: Output,
                // Screenshots reach the model as images, so the built-in agent sees what it clicks.
                toModelOutput: ({ output }) => [
                  { type: "text", text: output.output },
                  ...output.images.map((image) => ({
                    type: "file" as const,
                    mime: image.mime,
                    data: image.data,
                    name: "screenshot.png",
                  })),
                ],
                execute: (input, context) =>
                  Effect.gen(function* () {
                    const ask = (question: string) =>
                      Effect.runPromise(
                        permission
                          .assert({
                            action: PERMISSION,
                            resources: [tool.name],
                            save: ["*"],
                            metadata: { tool: tool.name, question, ...input },
                            sessionID: context.sessionID,
                            agent: context.agent,
                            source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                          })
                          .pipe(
                            Effect.as("once" as const),
                            Effect.catch(() => Effect.succeed("deny" as const)),
                          ),
                      )
                    const result = yield* Effect.promise(() =>
                      HarnessComputerProxy.shared.call(
                        tool.name,
                        input,
                        { sessionID: context.sessionID, directory: location.directory, harness: "Tenon" },
                        ask,
                      ),
                    )
                    const output = result.content
                      .flatMap((item) => (typeof item.text === "string" ? [item.text] : []))
                      .join("\n")
                    // A screenshot is kept with the thread's history, so an oversized one is described instead.
                    const images = result.content.flatMap((item) =>
                      item.type === "image" && typeof item.data === "string" && item.data.length <= MAX_IMAGE_BASE64
                        ? [{ mime: typeof item.mimeType === "string" ? item.mimeType : "image/png", data: item.data }]
                        : [],
                    )
                    // The agent is told when a screenshot was left out, so it doesn't act as if it saw the screen.
                    const omitted = result.content
                      .filter(
                        (item) =>
                          item.type === "image" && typeof item.data === "string" && item.data.length > MAX_IMAGE_BASE64,
                      )
                      .map(
                        (item) =>
                          `Screenshot left out: at ${((String(item.data).length * 3) / 4 / 1_000_000).toFixed(1)} MB it is over the ${(MAX_IMAGE_BASE64 * 3) / 4 / 1_000_000} MB a thread keeps. The screen was not seen.`,
                      )
                    if (result.isError) return yield* Effect.fail(new Error(output || `${tool.name} failed.`))
                    const text = [output, ...omitted].filter(Boolean).join("\n")
                    return { output: text || (images.length > 0 ? "Screenshot attached." : ""), images }
                  }).pipe(
                    Tool.mapError(
                      (error) =>
                        new ToolFailure({ message: error instanceof Error ? error.message : "Computer use failed" }),
                    ),
                  ),
              }),
            ]),
          ),
        )
        .pipe(Effect.ignore)
    const first = yield* list
    if (first.length > 0) return yield* register(first)
    // The driver can be slow to start or fail once: try again in the background a few times, so a Project that has
    // computer use on doesn't stay without its tools until the folder's services restart.
    yield* list.pipe(
      Effect.flatMap((listed) => (listed.length > 0 ? register(listed) : Effect.fail("no tools" as const))),
      Effect.retry({ schedule: Schedule.spaced("5 seconds"), times: 3 }),
      Effect.ignore,
      Effect.forkScoped,
    )
  }),
)

export const node = makeLocationNode({
  name: "tool/computer-tools",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, Location.node],
})
