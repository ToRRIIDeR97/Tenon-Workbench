import { DateTime, Option, Schema, SchemaGetter } from "effect"

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const RelativePath = Schema.String.pipe(Schema.brand("RelativePath"))
export type RelativePath = typeof RelativePath.Type

export const AbsolutePath = Schema.String.pipe(Schema.brand("AbsolutePath"))
export type AbsolutePath = typeof AbsolutePath.Type

export const optional = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(Schema.toType(schema)), {
      decode: SchemaGetter.passthrough({ strict: false }),
      encode: SchemaGetter.transformOptional(Option.filter((value) => value !== undefined)),
    }),
  )

export const statics =
  <S extends Schema.Top, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M => {
    const added = methods(schema)
    // Effect 4.1 schemas expose members such as `make` through prototype getters
    // that memoize a non-writable own property on first read, so a schema whose
    // `make` was read cannot be extended in place. Add the statics as own data
    // properties of a fresh copy (`annotate({})` rebuilds the same schema).
    return Object.defineProperties(
      schema.annotate({}),
      Object.fromEntries(
        Object.entries(added).map(([key, value]) => [key, { value, enumerable: true, writable: true, configurable: true }]),
      ),
    ) as S & M
  }

export const DateTimeUtcFromMillis = Schema.Finite.pipe(
  Schema.decodeTo(Schema.DateTimeUtc, {
    decode: SchemaGetter.transform((value) => DateTime.makeUnsafe(value)),
    encode: SchemaGetter.transform((value) => DateTime.toEpochMillis(value)),
  }),
)
