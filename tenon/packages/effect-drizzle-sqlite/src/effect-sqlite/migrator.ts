/* oxlint-disable */
import type { MigrationConfig } from "drizzle-orm/migrator"
import { readMigrationFiles } from "drizzle-orm/migrator"
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations"
import { migrate as coreMigrate, type SQLiteEffectSession } from "drizzle-orm/sqlite-core/effect/session"
import type { EffectSQLiteDatabase } from "./driver"
import type { EffectSQLiteQueryEffectHKT } from "./session"

export function migrate<TRelations extends AnyRelations>(
  db: EffectSQLiteDatabase<TRelations>,
  config: MigrationConfig,
) {
  const migrations = readMigrationFiles(config)
  return coreMigrate(migrations, db._.session as unknown as SQLiteEffectSession<unknown, EffectSQLiteQueryEffectHKT, EmptyRelations>, config)
}
