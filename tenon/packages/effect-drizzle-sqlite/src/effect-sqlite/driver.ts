/* oxlint-disable */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SqlClient } from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import { EffectCache } from "drizzle-orm/cache/core/cache-effect"
import { EffectLogger } from "drizzle-orm/effect-core"
import { entityKind } from "drizzle-orm/entity"
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations"
import {
  booleanFromInteger,
  bufferFromBytes,
  castToText,
  dateFromStoredMilliseconds,
  dateFromStoredSeconds,
  refineSqliteCodecs,
} from "drizzle-orm/sqlite-core/codecs"
import { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect"
import { SQLiteEffectDatabase } from "drizzle-orm/sqlite-core/effect/db"
import type { SQLiteEffectTransaction } from "drizzle-orm/sqlite-core/effect/session"
import type { EffectDrizzleSQLiteConfig as UpstreamConfig } from "drizzle-orm/sqlite-core/effect/utils"
import type { SQLiteTransactionConfig } from "drizzle-orm/sqlite-core/session"
import { type EffectSQLiteQueryEffectHKT, type EffectSQLiteRunResult, EffectSQLiteSession } from "./session"

export class EffectSQLiteDatabase<TRelations extends AnyRelations = EmptyRelations> extends SQLiteEffectDatabase<
  EffectSQLiteQueryEffectHKT,
  EffectSQLiteRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectSQLiteDatabase"

  /**
   * Runs `transaction` in a transaction. `config.behavior` picks `BEGIN DEFERRED`, `IMMEDIATE` or `EXCLUSIVE`;
   * without it the `SqlClient`'s default `BEGIN` is used.
   */
  override transaction<A, E, R>(
    transaction: (
      tx: SQLiteEffectTransaction<EffectSQLiteQueryEffectHKT, EffectSQLiteRunResult, TRelations>,
    ) => Effect.Effect<A, E, R>,
    config?: SQLiteTransactionConfig,
  ): Effect.Effect<A, E | SqlError, R> {
    return (this._.session as EffectSQLiteSession<TRelations>).transaction(transaction, config)
  }
}

export type EffectDrizzleSQLiteConfig<TRelations extends AnyRelations = EmptyRelations> = UpstreamConfig<TRelations>

/**
 * The column codecs of upstream's `drizzle-orm/effect-sqlite-bun` and `-node` drivers, which are identical:
 * both Effect SQLite clients return the same JavaScript values.
 */
export const effectSQLiteCodecs = refineSqliteCodecs({
  "integer:boolean": { normalize: booleanFromInteger },
  "integer:timestamp": { normalize: dateFromStoredSeconds },
  "integer:timestamp_ms": { normalize: dateFromStoredMilliseconds },
  "text:json": { normalize: JSON.parse },
  blob: { normalize: bufferFromBytes },
  "blob:json": { cast: castToText, normalize: JSON.parse },
  "blob:bigint": { cast: castToText, normalize: BigInt },
  numeric: { cast: castToText, normalize: String },
  "numeric:number": { normalize: Number },
  "numeric:bigint": { cast: castToText, normalize: BigInt },
})

export const DefaultServices = Layer.merge(EffectCache.Default, EffectLogger.Default)

// Drizzle's own check is not in its declarations: JIT mappers need `new Function`, which a CSP can forbid.
function jitCompatCheck(isEnabled: boolean | undefined) {
  if (!isEnabled) return false
  try {
    return new Function("input", '"use strict"; return input;')(true) === true
  } catch {
    return false
  }
}

/**
 * Creates an EffectSQLiteDatabase instance.
 *
 * Requires a generic Effect `SqlClient`, `EffectLogger`, and `EffectCache` services to be provided.
 * Drizzle only depends on the generic `SqlClient`; provide any SQLite client that exposes it, such as
 * `@effect/sql-sqlite-node`, `@effect/sql-sqlite-bun`, or core's own `#sqlite` clients.
 *
 * @example
 * ```ts
 * const db = yield* EffectDrizzleSqlite.make({ relations }).pipe(
 *   Effect.provide(EffectDrizzleSqlite.DefaultServices),
 *   Effect.provide(SqliteClient.layer({ filename: 'sqlite.db' })),
 * );
 * ```
 */
export const make = Effect.fn("SQLiteDrizzle.make")(function* <TRelations extends AnyRelations = EmptyRelations>(
  config: EffectDrizzleSQLiteConfig<TRelations> = {},
) {
  const client = yield* SqlClient
  const cache = yield* EffectCache
  const logger = yield* EffectLogger

  const dialect = new SQLiteDialect({
    codecs: config.codecs ?? effectSQLiteCodecs,
    useJitMappers: jitCompatCheck(config.jit),
  })
  const relations = config.relations ?? ({} as TRelations)
  const session = new EffectSQLiteSession(client, dialect, relations, {
    logger,
    cache,
    paramsInErrors: config.paramsInErrors,
  })
  const db = new EffectSQLiteDatabase(dialect, session, relations) as EffectSQLiteDatabase<TRelations> & {
    $client: SqlClient
  }
  db.$client = client
  db.$cache.invalidate = cache.onMutate

  return db
})

/**
 * Convenience function that creates an EffectSQLiteDatabase with `DefaultServices` already provided.
 */
export const makeWithDefaults = <TRelations extends AnyRelations = EmptyRelations>(
  config: EffectDrizzleSQLiteConfig<TRelations> = {},
) => make(config).pipe(Effect.provide(DefaultServices))
