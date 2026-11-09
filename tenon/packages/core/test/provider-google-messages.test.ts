import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { expect, test } from "bun:test"

test("Google drops assistant turns whose parts are all empty", async () => {
  let body: { contents?: Array<{ role: string }> } | undefined
  const mockFetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      })
    },
    { preconnect: fetch.preconnect },
  )
  const model = createGoogleGenerativeAI({ apiKey: "test", fetch: mockFetch })("gemini-2.5-flash")

  await model.doGenerate({
    prompt: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { google: { thoughtSignature: "sig" } } },
          { type: "text", text: "" },
        ],
      },
      { role: "user", content: [{ type: "text", text: "Hello again" }] },
    ],
  })

  expect(body?.contents?.map((entry) => entry.role)).toEqual(["user", "user"])
})
