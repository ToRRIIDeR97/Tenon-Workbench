import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { emptyStructsAsObjects, Tool, toDefinitions } from "../src/tool"

describe("tool JSON Schema", () => {
  test("a tool without parameters sends an empty object schema", () => {
    const tool = Tool.make({
      description: "List things",
      parameters: Schema.Struct({ nested: Schema.Struct({}) }),
      success: Schema.String,
      execute: () => Effect.succeed("ok"),
    })
    const empty = Tool.make({
      description: "No input",
      parameters: Schema.Struct({}),
      success: Schema.String,
      execute: () => Effect.succeed("ok"),
    })
    const [withNested, withoutInput] = toDefinitions({ tool, empty })
    expect(withoutInput?.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false })
    expect(withNested?.inputSchema).toMatchObject({
      type: "object",
      properties: { nested: { type: "object", properties: {}, additionalProperties: false } },
    })
  })

  test("leaves property maps alone even when a property is named `not`", () => {
    const schema = { type: "object", properties: { not: { type: "null" } } }
    expect(emptyStructsAsObjects(schema)).toEqual(schema)
  })
})
