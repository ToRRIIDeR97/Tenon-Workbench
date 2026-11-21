import { beforeEach, describe, expect } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { FSUtil } from "@tenon/core/fs-util"
import { Location } from "@tenon/core/location"
import { LocationMutation } from "@tenon/core/location-mutation"
import { PermissionV2 } from "@tenon/core/permission"
import { Ripgrep } from "@tenon/core/ripgrep"
import { SessionV2 } from "@tenon/core/session"
import { AbsolutePath } from "@tenon/core/schema"
import { GlobTool } from "@tenon/core/tool/glob"
import { GrepTool } from "@tenon/core/tool/grep"
import { ToolRegistry } from "@tenon/core/tool/registry"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool } from "./lib/tool"

// A real folder, so grep can tell a file from a directory.
const root = mkdtempSync(path.join(os.tmpdir(), "tenon-search-permissions-"))
const workspace = path.join(root, "workspace")
const outside = path.join(root, "outside")
mkdirSync(workspace)
mkdirSync(outside)
writeFileSync(path.join(workspace, ".env"), "TOKEN=secret")

const assertions: PermissionV2.AssertInput[] = []
const searched: string[] = []
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
const ripgrep = Layer.succeed(
  Ripgrep.Service,
  Ripgrep.Service.of({
    find: () => Effect.succeed([]),
    glob: (input) => Effect.sync(() => (searched.push(input.cwd), [])),
    grep: (input) => Effect.sync(() => (searched.push(input.cwd), [])),
  }),
)
// The real resolver needs a project; this one marks anything outside the workspace as external, as it does.
const mutation = Layer.succeed(
  LocationMutation.Service,
  LocationMutation.Service.of({
    resolve: (input) => {
      const canonical = path.resolve(workspace, input.path)
      const external = !FSUtil.contains(workspace, canonical)
      const resource = external ? canonical.replaceAll("\\", "/") : path.relative(workspace, canonical) || "."
      const directory = input.kind === "directory" ? canonical : path.dirname(canonical)
      const externalResource = path.join(directory, "*").replaceAll("\\", "/")
      return Effect.succeed({
        canonical,
        resource,
        externalDirectory: external
          ? { action: "external_directory" as const, directory, resource: externalResource, save: externalResource }
          : undefined,
      })
    },
  }),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GrepTool.node, GlobTool.node]), [
    [PermissionV2.node, permission],
    [Ripgrep.node, ripgrep],
    [LocationMutation.node, mutation],
    [FSUtil.node, LayerNode.compile(FSUtil.node)],
    [
      Location.node,
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(workspace) }))),
    ],
  ]),
)
const sessionID = SessionV2.ID.make("ses_search_permissions_test")
const call = (name: "grep" | "glob", input: Record<string, string>) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    return yield* executeTool(registry, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id: `call-${name}`, name, input },
    })
  })

describe("grep and glob permissions", () => {
  beforeEach(() => {
    assertions.length = 0
    searched.length = 0
  })

  it.effect("ask for an outside folder before searching it", () =>
    Effect.gen(function* () {
      const relative = path.relative(workspace, outside)
      for (const name of ["grep", "glob"] as const) {
        assertions.length = 0
        searched.length = 0
        yield* call(name, { pattern: "TOKEN", path: relative })
        expect(assertions.map((item) => item.action)).toEqual(["external_directory", name])
        expect(assertions[0]?.resources).toEqual([path.join(outside, "*").replaceAll("\\", "/")])
        expect(searched).toEqual([outside])
      }
    }),
  )

  it.effect("ask to read a single file grep searches, so a .env stays behind its read rule", () =>
    Effect.gen(function* () {
      yield* call("grep", { pattern: "TOKEN", path: ".env" })
      expect(assertions.map((item) => [item.action, item.resources])).toEqual([
        ["grep", ["TOKEN"]],
        ["read", [".env"]],
      ])
    }),
  )

  it.effect("search the workspace without extra prompts", () =>
    Effect.gen(function* () {
      yield* call("glob", { pattern: "*.md" })
      expect(assertions.map((item) => item.action)).toEqual(["glob"])
      expect(searched).toEqual([workspace])
    }),
  )
})
