import { Effect, Schema } from "effect"
import { executeWithLimits } from "./interpreter/runtime.js"
import { type HostTools, type Services, type ToolDescription, ToolRuntime } from "./tool-runtime.js"
import type { Definition } from "./tool.js"

export type { ToolCall, ToolCallEnded, ToolCallHooks, ToolCallStarted, ToolDescription } from "./tool-runtime.js"

export type ExecutionLimits = {
  readonly timeoutMs?: number
  readonly maxToolCalls?: number
  readonly maxOutputBytes?: number
}

export type DiscoveryOptions = {
  readonly catalogBudget?: number
}

type ToolTree<R = never> = {
  readonly [name: string]: Definition<R> | ToolTree<R>
}

export type ResolvedExecutionLimits = {
  readonly timeoutMs: number | undefined
  readonly maxToolCalls: number | undefined
  readonly maxOutputBytes: number | undefined
}

export type ExecuteOptions<Tools extends Record<string, unknown> = {}> = {
  code: string
  tools?: Tools & ToolTree<Services<Tools>>
  limits?: ExecutionLimits
  onToolCallStart?: (call: ToolRuntime.ToolCallStarted) => Effect.Effect<void, never, Services<Tools>>
  onToolCallEnd?: (call: ToolRuntime.ToolCallEnded) => Effect.Effect<void, never, Services<Tools>>
}

export type DataValue = Schema.Json

export type Options<Tools extends Record<string, unknown> = {}> = Omit<ExecuteOptions<Tools>, "code"> & {
  readonly discovery?: DiscoveryOptions
}

export const Input = Schema.Struct({ code: Schema.String })
export type Input = typeof Input.Type

export const DiagnosticKind = Schema.Literals([
  "ParseError",
  "UnsupportedSyntax",
  "UnknownTool",
  "InvalidToolInput",
  "InvalidToolOutput",
  "InvalidDataValue",
  "ToolCallLimitExceeded",
  "TimeoutExceeded",
  "ToolFailure",
  "ExecutionFailure",
])
export type DiagnosticKind = typeof DiagnosticKind.Type

export const Diagnostic = Schema.Struct({
  kind: DiagnosticKind,
  message: Schema.String,
  location: Schema.optionalKey(Schema.Struct({ line: Schema.Number, column: Schema.Number })),
  suggestions: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type Diagnostic = typeof Diagnostic.Type

const ToolCallSchema = Schema.Struct({ name: Schema.String })
export const Success = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Json,
  logs: Schema.optionalKey(Schema.Array(Schema.String)),
  truncated: Schema.optionalKey(Schema.Boolean),
  toolCalls: Schema.Array(ToolCallSchema),
})
export type Success = typeof Success.Type

export const Failure = Schema.Struct({
  ok: Schema.Literal(false),
  error: Diagnostic,
  logs: Schema.optionalKey(Schema.Array(Schema.String)),
  truncated: Schema.optionalKey(Schema.Boolean),
  toolCalls: Schema.Array(ToolCallSchema),
})
export type Failure = typeof Failure.Type

export const Result = Schema.Union([Success, Failure])
export type Result = typeof Result.Type

export type Runtime<R = never> = {
  readonly catalog: () => ReadonlyArray<ToolDescription>
  readonly instructions: () => string
  readonly execute: (code: string) => Effect.Effect<Result, never, R>
}

const validateLimit = <Value extends number | undefined>(
  name: keyof ExecutionLimits,
  value: Value,
  minimum: number,
): Value => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`)
  }
  return value
}

const resolveExecutionLimits = (limits?: ExecutionLimits): ResolvedExecutionLimits => ({
  timeoutMs: validateLimit("timeoutMs", limits?.timeoutMs, 1),
  maxToolCalls: validateLimit("maxToolCalls", limits?.maxToolCalls, 0),
  maxOutputBytes: validateLimit("maxOutputBytes", limits?.maxOutputBytes, 0),
})

export const execute = <const Tools extends Record<string, unknown>>(
  options: ExecuteOptions<Tools>,
): Effect.Effect<Result, never, Services<Tools>> => {
  const tools = (options.tools ?? {}) as HostTools<Services<Tools>>
  ToolRuntime.assertValidTools(tools)
  return executeWithLimits(options, resolveExecutionLimits(options.limits), ToolRuntime.searchIndex(tools))
}

export const make = <const Tools extends Record<string, unknown> = {}>(
  options: Options<Tools> = {} as Options<Tools>,
): Runtime<Services<Tools>> => {
  const tools = (options.tools ?? {}) as HostTools<Services<Tools>>
  ToolRuntime.assertValidTools(tools)
  const limits = resolveExecutionLimits(options.limits)
  const prepared = ToolRuntime.prepare(tools, options.discovery?.catalogBudget)

  return {
    catalog: () => prepared.catalog,
    instructions: () => prepared.instructions,
    execute: (code) => executeWithLimits<Tools>({ ...options, code }, limits, prepared.searchIndex),
  }
}
