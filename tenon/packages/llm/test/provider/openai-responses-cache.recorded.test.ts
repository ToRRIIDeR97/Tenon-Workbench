import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as OpenAI from "../../src/providers/openai"
import { LARGE_CACHEABLE_SYSTEM } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = OpenAI.configure({
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
}).responses("gpt-4.1-mini")

const cacheRequest = LLM.request({
  id: "recorded_openai_responses_cache",
  model,
  system: LARGE_CACHEABLE_SYSTEM,
  prompt: "Say hi.",
  generation: { maxTokens: 16, temperature: 0 },
  providerOptions: { openai: { promptCacheKey: "recorded-cache-test" } },
})

const recorded = recordedTests({
  prefix: "openai-responses-cache",
  provider: "openai",
  protocol: "openai-responses",
  requires: ["OPENAI_API_KEY"],
})

describe("OpenAI Responses cache recorded", () => {
  recorded.effect.with("reports cached_tokens on identical second call", { tags: ["cache"] }, () =>
    Effect.gen(function* () {
      const first = yield* LLMClient.generate(cacheRequest)
      expect(first.usage?.cacheReadInputTokens ?? 0).toBeGreaterThanOrEqual(0)

      const second = yield* LLMClient.generate(cacheRequest)
      expect(second.usage?.cacheReadInputTokens ?? 0).toBeGreaterThan(0)
    }),
  )
})
