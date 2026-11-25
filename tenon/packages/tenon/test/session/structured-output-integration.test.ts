import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@tenon/core/v1/session"
import { Ripgrep } from "@tenon/core/ripgrep"
import { Effect } from "effect"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { Session } from "@/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { testEffect } from "../lib/effect"

const hasApiKey = !!process.env.ANTHROPIC_API_KEY
const it = testEffect(AppNodeBuilder.build(LayerNode.group([SessionPrompt.node, Session.node, Ripgrep.node])))
const live = hasApiKey ? it.instance : it.instance.skip

describe("StructuredOutput Integration", () => {
  live(
    "produces structured output with simple schema",
    () =>
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "Structured Output Test" })

        const result = yield* prompt.prompt({
          sessionID: session.id,
          parts: [
            {
              type: "text",
              text: "What is 2 + 2? Provide a simple answer.",
            },
          ],
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                answer: { type: "number", description: "The numerical answer" },
                explanation: { type: "string", description: "Brief explanation" },
              },
              required: ["answer"],
            },
            retryCount: 0,
          },
        })

        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.structured).toBeDefined()
          expect(typeof result.info.structured).toBe("object")

          const output = result.info.structured as any
          expect(output.answer).toBe(4)

          expect(result.info.error).toBeUndefined()
        }
      }),
    { git: true },
    60000,
  )

  live(
    "produces structured output with nested objects",
    () =>
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "Nested Schema Test" })

        const result = yield* prompt.prompt({
          sessionID: session.id,
          parts: [
            {
              type: "text",
              text: "Tell me about Anthropic company in a structured format.",
            },
          ],
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                company: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    founded: { type: "number" },
                  },
                  required: ["name", "founded"],
                },
                products: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["company"],
            },
            retryCount: 0,
          },
        })

        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.structured).toBeDefined()
          const output = result.info.structured as any

          expect(output.company).toBeDefined()
          expect(output.company.name).toBe("Anthropic")
          expect(typeof output.company.founded).toBe("number")

          if (output.products) {
            expect(Array.isArray(output.products)).toBe(true)
          }

          expect(result.info.error).toBeUndefined()
        }
      }),
    { git: true },
    60000,
  )

  live(
    "works with text outputFormat (default)",
    () =>
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "Text Output Test" })

        const result = yield* prompt.prompt({
          sessionID: session.id,
          parts: [
            {
              type: "text",
              text: "Say hello.",
            },
          ],
          format: {
            type: "text",
          },
        })

        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.structured).toBeUndefined()
          expect(result.info.error).toBeUndefined()
        }

        expect(result.parts.length).toBeGreaterThan(0)
      }),
    { git: true },
    60000,
  )

  live(
    "stores outputFormat on user message",
    () =>
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "OutputFormat Storage Test" })

        yield* prompt.prompt({
          sessionID: session.id,
          parts: [
            {
              type: "text",
              text: "What is 1 + 1?",
            },
          ],
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                result: { type: "number" },
              },
              required: ["result"],
            },
            retryCount: 3,
          },
        })

        const messages = yield* sessions.messages({ sessionID: session.id })
        const userMessage = messages.find((m) => m.info.role === "user")

        expect(userMessage).toBeDefined()
        if (userMessage?.info.role === "user") {
          expect(userMessage.info.format).toBeDefined()
          expect(userMessage.info.format?.type).toBe("json_schema")
          if (userMessage.info.format?.type === "json_schema") {
            expect(userMessage.info.format.retryCount).toBe(3)
          }
        }
      }),
    { git: true },
    60000,
  )

  test("unit test: StructuredOutputError is properly structured", () => {
    const error = new SessionV1.StructuredOutputError({
      message: "Failed to produce valid structured output after 3 attempts",
      retries: 3,
    })

    expect(error.name).toBe("StructuredOutputError")
    expect(error.data.message).toContain("3 attempts")
    expect(error.data.retries).toBe(3)

    const obj = error.toObject()
    expect(obj.name).toBe("StructuredOutputError")
    expect(obj.data.retries).toBe(3)
  })
})
