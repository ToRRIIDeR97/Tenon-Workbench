import { Schema } from "effect"
import {
  AbsolutePath,
  DateTimeUtcFromMillis,
  NonNegativeInt,
  optional,
  PositiveInt,
  RelativePath,
  statics,
} from "@tenon/schema/schema"

export { AbsolutePath, DateTimeUtcFromMillis, NonNegativeInt, optional, PositiveInt, RelativePath, statics }

// eslint-disable-next-line @typescript-eslint/ban-types
export type DeepMutable<T> = T extends string | number | boolean | bigint | symbol | Function
  ? T
  : T extends readonly [unknown, ...unknown[]]
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T extends readonly (infer U)[]
      ? DeepMutable<U>[]
      : T extends object
        ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
        : T

export function Newtype<Self>() {
  return <const Tag extends string, S extends Schema.Top>(tag: Tag, schema: S) => {
    abstract class Base {
      declare readonly _newtype: Tag

      static make(value: Schema.Schema.Type<S>): Self {
        return value as unknown as Self
      }
    }

    Object.setPrototypeOf(Base, schema)

    return Base as unknown as (abstract new (_: never) => { readonly _newtype: Tag }) & {
      readonly make: (value: Schema.Schema.Type<S>) => Self
    } & Omit<Schema.Opaque<Self, S, {}>, "make" | "~type.make"> & {
        readonly "~type.make": Self
      }
  }
}
