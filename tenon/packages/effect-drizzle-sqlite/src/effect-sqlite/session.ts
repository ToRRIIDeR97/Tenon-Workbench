/* oxlint-disable */
import * as Effect from "effect/Effect"
import { BeginTransaction, type SqlClient } from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import type { EffectCacheShape } from "drizzle-orm/cache/core/cache-effect"
import type { QueryMetadata, WithCacheConfig } from "drizzle-orm/cache/core/types"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import type { EffectLoggerShape } from "drizzle-orm/effect-core/logger"
import type { QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import type { AnyRelations } from "drizzle-orm/relations"
import type { Query } from "drizzle-orm/sql/sql"
import type { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect"
import {
  SQLiteEffectPreparedQuery,
  SQLiteEffectSession,
  SQLiteEffectTransaction,
} from "drizzle-orm/sqlite-core/effect/session"
import type { PreparedQueryConfig, SQLiteExecuteMethod, SQLiteTransactionConfig } from "drizzle-orm/sqlite-core/session"

export interface EffectSQLiteQueryEffectHKT extends QueryEffectHKTBase {
  readonly error: EffectDrizzleQueryError
  readonly context: never
}

export type EffectSQLiteRunResult = readonly never[]

export interface EffectSQLiteSessionOptions {
  logger: EffectLoggerShape
  cache: EffectCacheShape
  paramsInErrors?: boolean
}

export class EffectSQLiteSession<TRelations extends AnyRelations> extends SQLiteEffectSession<
  EffectSQLiteRunResult,
  EffectSQLiteQueryEffectHKT,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectSQLiteSession"

  constructor(
    private client: SqlClient,
    dialect: SQLiteDialect,
    protected relations: TRelations,
    private options: EffectSQLiteSessionOptions,
  ) {
    super(dialect)
  }

  override prepareQuery<T extends PreparedQueryConfig = PreparedQueryConfig>(
    query: Query,
    mode: "arrays" | "objects" | "raw",
    _prepare: boolean,
    executeMethod?: SQLiteExecuteMethod,
    mapper?: (rows: any[]) => any,
    queryMetadata?: QueryMetadata,
    cacheConfig?: WithCacheConfig,
  ): SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT> {
    const client = this.client
    return new SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT>(
      executeMethod,
      {
        all: (params) => {
          const statement = client.unsafe(query.sql, params)
          return mode === "arrays" ? statement.values : statement.withoutTransform
        },
        get: (params) => {
          const statement = client.unsafe(query.sql, params)
          return mode === "arrays"
            ? statement.values.pipe(Effect.map((rows) => rows[0]))
            : statement.withoutTransform.pipe(Effect.map((rows) => rows[0]))
        },
        run: (params) => client.unsafe(query.sql, params).raw,
      },
      query,
      mapper,
      mode,
      this.options.logger,
      this.options.cache,
      queryMetadata,
      cacheConfig,
      this.options.paramsInErrors,
    )
  }

  override transaction<A, E, R>(
    transaction: (tx: EffectSQLiteTransaction<TRelations>) => Effect.Effect<A, E, R>,
    config?: SQLiteTransactionConfig,
  ): Effect.Effect<A, E | SqlError, R> {
    const { dialect, relations } = this
    const effect = this.client.withTransaction(
      Effect.suspend(() => transaction(new EffectSQLiteTransaction<TRelations>(dialect, this, relations))),
    )
    return config?.behavior === undefined
      ? effect
      : Effect.provideService(effect, BeginTransaction, `BEGIN ${config.behavior.toUpperCase()}`)
  }
}

export class EffectSQLiteTransaction<TRelations extends AnyRelations> extends SQLiteEffectTransaction<
  EffectSQLiteQueryEffectHKT,
  EffectSQLiteRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectSQLiteTransaction"

  override transaction<A, E, R>(
    transaction: (
      tx: SQLiteEffectTransaction<EffectSQLiteQueryEffectHKT, EffectSQLiteRunResult, TRelations>,
    ) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | SqlError, R> {
    return (this._.session as EffectSQLiteSession<TRelations>).transaction(transaction)
  }
}
