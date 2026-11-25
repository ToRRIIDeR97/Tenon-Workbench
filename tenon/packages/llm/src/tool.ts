import { Effect, JsonSchema, Schema } from "effect"
import type {
  ToolCallPart,
  ToolContent,
  ToolDefinition as ToolDefinitionClass,
  ToolOutput as ToolOutputType,
} from "./schema"
import { ToolDefinition, ToolFailure, ToolOutput } from "./schema"

export type ToolSchema<T> = Schema.Codec<T, any, never, never>
export interface ToolExecuteContext {
  readonly id: ToolCallPart["id"]
  readonly name: ToolCallPart["name"]
}

export type ToolExecute<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> = (
  params: Schema.Schema.Type<Parameters>,
  context?: ToolExecuteContext,
) => Effect.Effect<Schema.Schema.Type<Success>, ToolFailure>

export interface ToolModelOutputInput<Parameters, Output> {
  readonly callID: ToolCallPart["id"]
  readonly parameters: Parameters
  readonly output: Output
}

export type ToolToModelOutput<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> = (
  input: ToolModelOutputInput<Schema.Schema.Type<Parameters>, Success["Encoded"]>,
) => ReadonlyArray<ToolContent>

export interface Tool<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly execute?: ToolExecute<Parameters, Success>
  readonly toModelOutput?: ToolToModelOutput<Parameters, Success>
  readonly toStructuredOutput?: (output: Success["Encoded"]) => unknown
  readonly _decode: (input: unknown) => Effect.Effect<Schema.Schema.Type<Parameters>, Schema.SchemaError>
  readonly _encode: (value: Schema.Schema.Type<Success>) => Effect.Effect<unknown, Schema.SchemaError>
  readonly _project: (
    parameters: Schema.Schema.Type<Parameters>,
    callID: ToolCallPart["id"],
    output: unknown,
  ) => ToolOutputType
  readonly _legacyResult: boolean
  readonly _definition: ToolDefinitionClass
}

export type AnyTool = Tool<any, any>

export type ExecutableTool<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> = Tool<
  Parameters,
  Success
> & {
  readonly execute: ToolExecute<Parameters, Success>
}

export type AnyExecutableTool = ExecutableTool<any, any>

export type ExecutableTools = Record<string, AnyExecutableTool>

type TypedToolConfig = {
  readonly description: string
  readonly parameters: ToolSchema<any>
  readonly success: ToolSchema<any>
  readonly execute?: ToolExecute<ToolSchema<any>, ToolSchema<any>>
  readonly toModelOutput?: ToolToModelOutput<ToolSchema<any>, ToolSchema<any>>
  readonly toStructuredOutput?: (output: unknown) => unknown
}

type DynamicToolConfig = {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly execute?: (params: unknown, context?: ToolExecuteContext) => Effect.Effect<unknown, ToolFailure>
  readonly toModelOutput?: (input: ToolModelOutputInput<unknown, unknown>) => ReadonlyArray<ToolContent>
  readonly toStructuredOutput?: (output: unknown) => unknown
}

export function make<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>>(config: {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly execute: ToolExecute<Parameters, Success>
  readonly toModelOutput?: ToolToModelOutput<Parameters, Success>
  readonly toStructuredOutput?: (output: Success["Encoded"]) => unknown
}): ExecutableTool<Parameters, Success>
export function make<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>>(config: {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly execute?: undefined
  readonly toModelOutput?: ToolToModelOutput<Parameters, Success>
  readonly toStructuredOutput?: (output: Success["Encoded"]) => unknown
}): Tool<Parameters, Success>
export function make(config: {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly execute: (params: unknown, context?: ToolExecuteContext) => Effect.Effect<unknown, ToolFailure>
  readonly toModelOutput?: (input: ToolModelOutputInput<unknown, unknown>) => ReadonlyArray<ToolContent>
  readonly toStructuredOutput?: (output: unknown) => unknown
}): AnyExecutableTool
export function make(config: {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly execute?: undefined
  readonly toModelOutput?: (input: ToolModelOutputInput<unknown, unknown>) => ReadonlyArray<ToolContent>
  readonly toStructuredOutput?: (output: unknown) => unknown
}): AnyTool
export function make(config: TypedToolConfig | DynamicToolConfig): AnyTool {
  if ("jsonSchema" in config) {
    return {
      description: config.description,
      parameters: Schema.Unknown as ToolSchema<unknown>,
      success: Schema.Unknown as ToolSchema<unknown>,
      execute: config.execute,
      toModelOutput: config.toModelOutput,
      toStructuredOutput: config.toStructuredOutput,
      _decode: Effect.succeed,
      _encode: Effect.succeed,
      _project: (parameters, callID, output) =>
        project(config.toModelOutput, config.toStructuredOutput, parameters, callID, output),
      _legacyResult: config.toModelOutput === undefined && config.toStructuredOutput === undefined,
      _definition: new ToolDefinition({
        name: "",
        description: config.description,
        inputSchema: config.jsonSchema,
        outputSchema: config.outputSchema,
      }),
    }
  }
  return {
    description: config.description,
    parameters: config.parameters,
    success: config.success,
    execute: config.execute,
    toModelOutput: config.toModelOutput,
    toStructuredOutput: config.toStructuredOutput,
    _decode: Schema.decodeUnknownEffect(config.parameters),
    _encode: Schema.encodeEffect(config.success),
    _project: (parameters, callID, output) =>
      project(config.toModelOutput, config.toStructuredOutput, parameters, callID, output),
    _legacyResult: false,
    _definition: new ToolDefinition({
      name: "",
      description: config.description,
      inputSchema: toJsonSchema(config.parameters),
      outputSchema: toJsonSchema(config.success),
    }),
  }
}

export type Tools = Record<string, AnyTool>

export const toDefinitions = (tools: Tools): ReadonlyArray<ToolDefinitionClass> =>
  Object.entries(tools).map(
    ([name, item]) =>
      new ToolDefinition({
        name,
        description: item._definition.description,
        inputSchema: item._definition.inputSchema,
        outputSchema: item._definition.outputSchema,
      }),
  )

const toJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" })
  const result =
    Object.keys(document.definitions).length === 0
      ? document.schema
      : { ...document.schema, $defs: document.definitions }
  return emptyStructsAsObjects(result, { additionalProperties: false }) as JsonSchema.JsonSchema
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const emptyStructsAsObjects = (value: unknown, options: { additionalProperties?: boolean } = {}): unknown => {
  if (Array.isArray(value)) return value.map((item) => emptyStructsAsObjects(item, options))
  if (!isRecord(value)) return value
  const { not, ...rest } = value
  if (isRecord(not) && Object.keys(not).length === 1 && not.type === "null" && rest.type === undefined)
    return {
      ...rest,
      type: "object",
      properties: {},
      ...(options.additionalProperties === undefined ? {} : { additionalProperties: options.additionalProperties }),
    }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      schemaMaps.has(key) && isRecord(item)
        ? Object.fromEntries(Object.entries(item).map(([name, entry]) => [name, emptyStructsAsObjects(entry, options)]))
        : emptyStructsAsObjects(item, options),
    ]),
  )
}

const schemaMaps = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"])

const project = (
  toModelOutput: ((input: ToolModelOutputInput<any, any>) => ReadonlyArray<ToolContent>) | undefined,
  toStructuredOutput: ((output: unknown) => unknown) | undefined,
  parameters: unknown,
  callID: ToolCallPart["id"],
  output: unknown,
): ToolOutputType =>
  ToolOutput.make(
    toStructuredOutput?.(output) ?? output,
    toModelOutput?.({ callID, parameters, output }) ??
      (typeof output === "string" ? [{ type: "text", text: output }] : []),
  )

export { ToolFailure }

export * as Tool from "./tool"
