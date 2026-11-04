import { AISDK } from "@tenon/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@tenon/core/model"
import { PluginV2 } from "@tenon/core/plugin"
import { PluginHost } from "@tenon/core/plugin/host"
import { PerplexityPlugin } from "@tenon/core/plugin/provider/perplexity"
import { ProviderV2 } from "@tenon/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* PerplexityPlugin.effect(host)
})

describe("PerplexityPlugin", () => {
  it.effect("creates a Perplexity SDK for the exact @ai-sdk/perplexity package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("perplexity"), ModelV2.ID.make("sonar")),
          api: { id: ModelV2.ID.make("sonar"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/perplexity",
        options: { name: "perplexity" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("ignores packages that are not the bundled Perplexity package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("perplexity"), ModelV2.ID.make("sonar")),
          api: { id: ModelV2.ID.make("sonar"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/perplexity-compatible",
        options: { name: "perplexity" },
      })
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("uses the Perplexity provider ID as the SDK name for the bundled provider", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("perplexity"), ModelV2.ID.make("sonar")),
          api: { id: ModelV2.ID.make("sonar"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/perplexity",
        options: { name: "perplexity" },
      })
      expect(result.sdk.languageModel("sonar").provider).toBe("perplexity")
    }),
  )

  it.effect("creates bundled Perplexity SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-perplexity"), ModelV2.ID.make("sonar")),
          api: { id: ModelV2.ID.make("sonar"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/perplexity",
        options: { name: "custom-perplexity" },
      })
      expect(result.sdk.languageModel("sonar").provider).toBe("perplexity")
    }),
  )
})
