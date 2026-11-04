import { AISDK } from "@tenon/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@tenon/core/model"
import { PluginV2 } from "@tenon/core/plugin"
import { PluginHost } from "@tenon/core/plugin/host"
import { MistralPlugin } from "@tenon/core/plugin/provider/mistral"
import { ProviderV2 } from "@tenon/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* MistralPlugin.effect(host)
})

describe("MistralPlugin", () => {
  it.effect("creates a Mistral SDK for @ai-sdk/mistral", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("mistral"), ModelV2.ID.make("mistral-large")),
          api: { id: ModelV2.ID.make("mistral-large"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/mistral",
        options: { name: "mistral" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("ignores non-Mistral SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("mistral"), ModelV2.ID.make("mistral-large")),
          api: { id: ModelV2.ID.make("mistral-large"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "mistral" },
      })
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("matches the old bundled Mistral SDK provider name for the bundled provider ID", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const providers: string[] = []
      yield* addPlugin()
      yield* aisdk.hook.sdk((event) =>
        Effect.sync(() => {
          providers.push(event.sdk.languageModel("mistral-large").provider)
        }),
      )
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("mistral"), ModelV2.ID.make("mistral-large")),
          api: { id: ModelV2.ID.make("mistral-large"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/mistral",
        options: { name: "mistral" },
      })
      expect(result.sdk).toBeDefined()
      expect(providers).toEqual(["mistral.chat"])
    }),
  )

  it.effect("matches the old bundled Mistral SDK provider name for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const providers: string[] = []
      yield* addPlugin()
      yield* aisdk.hook.sdk((event) =>
        Effect.sync(() => {
          providers.push(event.sdk.languageModel("mistral-large").provider)
        }),
      )
      yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-mistral"), ModelV2.ID.make("mistral-large")),
          api: { id: ModelV2.ID.make("mistral-large"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/mistral",
        options: { name: "custom-mistral" },
      })
      expect(providers).toEqual(["mistral.chat"])
    }),
  )
})
