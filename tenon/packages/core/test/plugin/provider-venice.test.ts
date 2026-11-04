import { AISDK } from "@tenon/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@tenon/core/model"
import { PluginV2 } from "@tenon/core/plugin"
import { PluginHost } from "@tenon/core/plugin/host"
import { VenicePlugin } from "@tenon/core/plugin/provider/venice"
import { ProviderV2 } from "@tenon/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* VenicePlugin.effect(host)
})

describe("VenicePlugin", () => {
  it.effect("creates a Venice SDK for venice-ai-sdk-provider", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("venice"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "venice-ai-sdk-provider",
        options: { name: "venice" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("uses the model provider ID as the bundled Venice SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-venice"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "venice-ai-sdk-provider",
        options: { name: "custom-venice", apiKey: "test" },
      })
      expect(result.sdk).toBeDefined()
      expect(result.sdk.languageModel("model").provider).toBe("custom-venice.chat")
    }),
  )

  it.effect("only handles the bundled venice-ai-sdk-provider package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const similar = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("venice"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "file:///tmp/venice-ai-sdk-provider.js",
        options: { name: "venice" },
      })
      const other = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("venice"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "venice" },
      })
      expect(similar.sdk).toBeUndefined()
      expect(other.sdk).toBeUndefined()
    }),
  )
})
