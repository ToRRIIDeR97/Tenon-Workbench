import { Effect, Schema } from "effect"

export type JsonSchema = {
  readonly type?: string | ReadonlyArray<string>
  readonly enum?: ReadonlyArray<unknown>
  readonly const?: unknown
  readonly anyOf?: ReadonlyArray<JsonSchema>
  readonly oneOf?: ReadonlyArray<JsonSchema>
  readonly allOf?: ReadonlyArray<JsonSchema>
  readonly not?: JsonSchema
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: ReadonlyArray<string>
  readonly items?: JsonSchema
  readonly additionalProperties?: boolean | JsonSchema
  readonly description?: string
  readonly default?: unknown
  readonly format?: string
  readonly deprecated?: boolean
  readonly minItems?: number
  readonly maxItems?: number
  readonly $ref?: string
  readonly $defs?: Readonly<Record<string, JsonSchema>>
  readonly definitions?: Readonly<Record<string, JsonSchema>>
}

export type SchemaType = Schema.Decoder<unknown> | JsonSchema

export type Definition<R = never> = {
  readonly _tag: "CodeModeTool"
  readonly description: string
  readonly input: SchemaType
  readonly output: SchemaType | undefined
  readonly run: (input: unknown) => Effect.Effect<unknown, unknown, R>
}

type InputType<S> = S extends Schema.Decoder<unknown> ? S["Type"] : unknown

type ResultType<S> = S extends Schema.Decoder<unknown> ? S["Encoded"] : unknown

export type Options<I extends SchemaType, O extends SchemaType | undefined, R = never> = {
  readonly description: string
  readonly input: I
  readonly output?: O
  readonly run: (input: InputType<I>) => Effect.Effect<ResultType<O>, unknown, R>
}

export const isDefinition = <R = never>(value: unknown): value is Definition<R> =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "CodeModeTool"

export const make = <I extends SchemaType, const O extends SchemaType | undefined = undefined, R = never>(
  options: Options<I, O, R>,
): Definition<R> => ({
  _tag: "CodeModeTool",
  description: options.description,
  input: options.input,
  output: options.output,
  run: (input) => options.run(input as InputType<I>),
})
