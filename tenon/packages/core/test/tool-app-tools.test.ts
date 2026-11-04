import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { HarnessAppTools } from "@tenon/core/harness/app-tools"
import { Location } from "@tenon/core/location"
import { PermissionV2 } from "@tenon/core/permission"
import { AbsolutePath } from "@tenon/core/schema"
import { SessionV2 } from "@tenon/core/session"
import { AppToolsTool } from "@tenon/core/tool/app-tools"
import { ToolRegistry } from "@tenon/core/tool/registry"
import { ToolOutputStore } from "@tenon/core/tool-output-store"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, toolDefinitions, toolIdentity } from "./lib/tool"

// AC-5.1: the in-process loop (the default OpenCode harness) gets the installed Tenon app tools.

const sessionID = SessionV2.ID.make("ses_app_tools_inprocess")
const assertions: PermissionV2.AssertInput[] = []
const calls: unknown[] = []
const writeSchema = {
  type: "object",
  properties: { path: { type: "string" }, body: { type: "string" } },
  required: ["path", "body"],
  additionalProperties: false,
}
const catalog: HarnessAppTools.Tool[] = [
  { name: "notes_write", description: "Write a page", inputSchema: writeSchema },
  {
    name: "notes_read",
    description: "Read a page",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    annotations: { readOnlyHint: true },
  },
]
let uninstall: (() => void) | undefined

afterEach(() => {
  uninstall?.()
  uninstall = undefined
  assertions.length = 0
  calls.length = 0
})

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => void assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const withRegistry = <A, E, R>(
  body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>,
  directory = process.cwd(),
) =>
  Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, AppToolsTool.node]), [
        [
          Location.node,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ],
        [PermissionV2.node, permission],
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ]),
    ),
  )

const install = () => {
  uninstall = HarnessAppTools.install({
    catalog,
    list: () => catalog,
    call: async (name, args, caller) => {
      calls.push({ name, args, sessionID: caller.sessionID })
      return { revision: "r1", undo: "undo_1" }
    },
  })
}

const it = testEffect(Layer.empty)

describe("AppToolsTool", () => {
  // AC-7.6: Command Centre-only tools are registered only in the Command Centre's folder.
  it.live("registers each folder's own catalog", () => {
    const commandFolder = `${process.cwd()}/.command-centre`
    const memory: HarnessAppTools.Tool = {
      name: "memory_search",
      description: "Search memory",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      annotations: { readOnlyHint: true },
    }
    uninstall = HarnessAppTools.install({
      catalog: [...catalog, memory],
      catalogFor: (directory) => (directory === commandFolder ? [...catalog, memory] : catalog),
      list: () => catalog,
      call: async () => ({}),
    })
    return Effect.gen(function* () {
      const project = yield* withRegistry((registry) => toolDefinitions(registry))
      expect(project.map((tool) => tool.name)).not.toContain("memory_search")
      const command = yield* withRegistry((registry) => toolDefinitions(registry), commandFolder)
      expect(command.map((tool) => tool.name)).toContain("memory_search")
    })
  })

  it.live("registers nothing while no app tools are installed", () =>
    withRegistry((registry) =>
      Effect.gen(function* () {
        expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([])
      }),
    ),
  )

  it.live("lists the installed app tools with their own input schema", () => {
    install()
    return withRegistry((registry) =>
      Effect.gen(function* () {
        const definitions = yield* toolDefinitions(registry)
        expect(definitions.map((tool) => tool.name).sort()).toEqual(["notes_read", "notes_write"])
        expect(definitions.find((tool) => tool.name === "notes_write")?.inputSchema).toEqual(writeSchema)
      }),
    )
  })

  it.live("asks tenon_write before a write and routes the call with the thread", () => {
    install()
    return withRegistry((registry) =>
      Effect.gen(function* () {
        const result = yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-1", name: "notes_write", input: { path: "Plan.md", body: "# Plan" } },
        })
        expect(JSON.stringify(result)).toContain("undo_1")
        expect(assertions.map((input) => [input.action, input.resources])).toEqual([["tenon_write", ["notes_write"]]])
        expect(calls).toEqual([{ name: "notes_write", args: { path: "Plan.md", body: "# Plan" }, sessionID }])

        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-2", name: "notes_read", input: { path: "Plan.md" } },
        })
        // Reads are not asked.
        expect(assertions).toHaveLength(1)
      }),
    )
  })
})
