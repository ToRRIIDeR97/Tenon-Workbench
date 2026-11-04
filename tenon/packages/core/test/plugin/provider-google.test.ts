import { AISDK } from "@tenon/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@tenon/core/model"
import { PluginV2 } from "@tenon/core/plugin"
import { PluginHost } from "@tenon/core/plugin/host"
import { GooglePlugin } from "@tenon/core/plugin/provider/google"
import { ProviderV2 } from "@tenon/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* GooglePlugin.effect(host)
})

describe("GooglePlugin", () => {
  it.effect("creates a Google Generative AI SDK for @ai-sdk/google using the provider ID as SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-google"), ModelV2.ID.make("gemini")),
          api: { id: ModelV2.ID.make("gemini"), type: "aisdk", package: "@ai-sdk/google" },
        }),
        package: "@ai-sdk/google",
        options: { name: "custom-google", apiKey: "test" },
      })
      expect(result.sdk).toBeDefined()
      expect(result.sdk?.languageModel("gemini").provider).toBe("custom-google")
    }),
  )

  it.effect("ignores non-Google SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("google"), ModelV2.ID.make("gemini")),
          api: { id: ModelV2.ID.make("gemini"), type: "aisdk", package: "@ai-sdk/google" },
        }),
        package: "@ai-sdk/google-vertex",
        options: { name: "google" },
      })
      expect(result.sdk).toBeUndefined()
    }),
  )
})
