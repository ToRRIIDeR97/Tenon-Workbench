import { AgentV2 } from "@tenon/core/agent"
import { AISDK } from "@tenon/core/aisdk"
import { Catalog } from "@tenon/core/catalog"
import { CommandV2 } from "@tenon/core/command"
import { Credential } from "@tenon/core/credential"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNodePlatform } from "@tenon/core/effect/app-node-platform"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { EventV2 } from "@tenon/core/event"
import { FileSystem } from "@tenon/core/filesystem"
import { FSUtil } from "@tenon/core/fs-util"
import { Integration } from "@tenon/core/integration"
import { Location } from "@tenon/core/location"
import { Npm } from "@tenon/core/npm"
import { PluginV2 } from "@tenon/core/plugin"
import { Reference } from "@tenon/core/reference"
import { SkillV2 } from "@tenon/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
