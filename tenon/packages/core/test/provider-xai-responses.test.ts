import { createXai } from "@ai-sdk/xai"
import { expect, test } from "bun:test"

test("xAI Responses sends promptCacheKey as prompt_cache_key", async () => {
  let body: Record<string, unknown> | undefined
  const mockFetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: "response-1",
        created_at: 0,
        model: "grok-4",
        object: "response",
        output: [],
        usage: { input_tokens: 1, output_tokens: 0 },
        status: "completed",
      })
    },
    { preconnect: fetch.preconnect },
  )
  const model = createXai({
    apiKey: "test",
    fetch: mockFetch,
  }).responses("grok-4")

  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    providerOptions: { xai: { promptCacheKey: "session-123" } },
  })

  expect(body?.prompt_cache_key).toBe("session-123")
})

test("xAI Responses passes through xhigh reasoning effort", async () => {
  let body: Record<string, unknown> | undefined
  const mockFetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: "response-1",
        created_at: 0,
        model: "grok-4",
        object: "response",
        output: [],
        usage: { input_tokens: 1, output_tokens: 0 },
        status: "completed",
      })
    },
    { preconnect: fetch.preconnect },
  )
  const model = createXai({ apiKey: "test", fetch: mockFetch }).responses("grok-4")

  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    providerOptions: { xai: { reasoningEffort: "xhigh" } },
  })

  expect(body?.reasoning).toEqual({ effort: "xhigh" })
})

test("xAI Chat passes through xhigh reasoning effort", async () => {
  let body: Record<string, unknown> | undefined
  const mockFetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: "chat-1",
        created: 0,
        model: "grok-4",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    },
    { preconnect: fetch.preconnect },
  )
  const model = createXai({ apiKey: "test", fetch: mockFetch }).chat("grok-4")

  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    providerOptions: { xai: { reasoningEffort: "xhigh" } },
  })

  expect(body?.reasoning_effort).toBe("xhigh")
})

test("xAI Responses sends inline PDF files as input_file data", async () => {
  let body: { input?: Array<{ content?: unknown }> } | undefined
  const mockFetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: "response-1",
        created_at: 0,
        model: "grok-4",
        object: "response",
        output: [],
        usage: { input_tokens: 1, output_tokens: 0 },
        status: "completed",
      })
    },
    { preconnect: fetch.preconnect },
  )
  const model = createXai({ apiKey: "test", fetch: mockFetch }).responses("grok-4")

  await model.doGenerate({
    prompt: [
      {
        role: "user",
        content: [
          { type: "file", mediaType: "application/pdf", data: new Uint8Array([37, 80, 68, 70]), filename: "a.pdf" },
          { type: "file", mediaType: "application/pdf", data: "file-abc" },
        ],
      },
    ],
  })

  expect(body?.input?.[0]?.content).toEqual([
    { type: "input_file", filename: "a.pdf", file_data: "data:application/pdf;base64,JVBERg==" },
    { type: "input_file", file_id: "file-abc" },
  ])
})
