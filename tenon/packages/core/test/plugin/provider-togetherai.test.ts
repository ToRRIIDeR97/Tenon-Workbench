import { AISDK } from "@tenon/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@tenon/core/model"
import { PluginV2 } from "@tenon/core/plugin"
import { PluginHost } from "@tenon/core/plugin/host"
import { TogetherAIPlugin } from "@tenon/core/plugin/provider/togetherai"
import { ProviderV2 } from "@tenon/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* TogetherAIPlugin.effect(host)
})

describe("TogetherAIPlugin", () => {
  it.effect("creates a TogetherAI SDK for @ai-sdk/togetherai", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("togetherai"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/togetherai",
        options: { name: "togetherai" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("matches the old bundled provider package exactly", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const ignored = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("togetherai"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "file:///tmp/@ai-sdk/togetherai-provider.js",
        options: { name: "togetherai" },
      })
      expect(ignored.sdk).toBeUndefined()

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("togetherai"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/togetherai",
        options: { name: "togetherai" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("creates bundled TogetherAI SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-togetherai"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/togetherai",
        options: { name: "custom-togetherai" },
      })

      expect(result.sdk.languageModel("model").provider).toBe("togetherai.chat")
    }),
  )
})
