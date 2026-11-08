import { Database as BunDatabase } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { isSqlError } from "effect/sql/SqlError"
import { EffectDrizzleSqlite } from "@tenon/effect-drizzle-sqlite"
import type { SQLiteEffectDatabase } from "drizzle-orm/sqlite-core/effect"
import { layer as bunLayer } from "@tenon/core/database/sqlite.bun"
import { tmpdir } from "./fixture/tmpdir"

// Transaction semantics of core's own SQLite clients, which mirror @effect/sql-sqlite-bun and -node 4.1:
// BEGIN IMMEDIATE by default, savepoints for nested transactions, and rollback after a failed COMMIT.
const nodeSupported = await import("node:sqlite").then(
  () => true,
  () => false,
)
const nodeLayer = nodeSupported ? (await import("@tenon/core/database/sqlite.node")).layer : undefined

const drivers = [
  { name: "bun:sqlite", layer: bunLayer, supported: true },
  { name: "node:sqlite", layer: nodeLayer ?? bunLayer, supported: nodeLayer !== undefined },
]

for (const driver of drivers) {
  describe.skipIf(!driver.supported)(`${driver.name} transactions`, () => {
    const run = <A, E>(
      filename: string,
      body: (db: Effect.Success<ReturnType<typeof EffectDrizzleSqlite.makeWithDefaults>>) => Effect.Effect<A, E>,
    ) =>
      Effect.runPromise(
        EffectDrizzleSqlite.makeWithDefaults().pipe(
          Effect.flatMap(body),
          Effect.provide(driver.layer({ filename, timeout: 0 })),
          Effect.scoped,
        ),
      )

    const names = (db: SQLiteEffectDatabase<EffectDrizzleSqlite.EffectSQLiteQueryEffectHKT, unknown>) =>
      db
        .all<{ name: string }>(sql`SELECT name FROM item ORDER BY id`)
        .pipe(Effect.map((rows) => rows.map((r) => r.name)))

    test("commits, rolls back, and rolls nested transactions back to their savepoint", async () => {
      const result = await run(":memory:", (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`CREATE TABLE item (id integer PRIMARY KEY, name text NOT NULL)`)
          yield* db.transaction((tx) => tx.run(sql`INSERT INTO item (name) VALUES ('committed')`))
          yield* db
            .transaction((tx) =>
              tx.run(sql`INSERT INTO item (name) VALUES ('rolled back')`).pipe(Effect.andThen(Effect.fail("boom"))),
            )
            .pipe(Effect.ignore)
          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.run(sql`INSERT INTO item (name) VALUES ('outer')`)
              yield* tx
                .transaction((nested) =>
                  nested
                    .run(sql`INSERT INTO item (name) VALUES ('savepoint')`)
                    .pipe(Effect.andThen(Effect.fail("boom"))),
                )
                .pipe(Effect.ignore)
              yield* tx.transaction((nested) => nested.run(sql`INSERT INTO item (name) VALUES ('released')`))
            }),
          )
          return yield* names(db)
        }),
      )
      expect(result).toEqual(["committed", "outer", "released"])
    })

    test("takes the write lock at BEGIN unless the transaction asks for deferred", async () => {
      await using tmp = await tmpdir()
      const filename = path.join(tmp.path, "locked.db")
      const holder = new BunDatabase(filename)
      try {
        holder.run("PRAGMA journal_mode = WAL")
        holder.run("CREATE TABLE item (id integer PRIMARY KEY, name text NOT NULL)")
        holder.run("BEGIN IMMEDIATE")
        const result = await run(filename, (db) =>
          Effect.gen(function* () {
            const deferred = yield* db.transaction((tx) => names(tx), { behavior: "deferred" })
            const error = yield* db.transaction((tx) => names(tx)).pipe(Effect.flip)
            return { deferred, error }
          }),
        )
        expect(result.deferred).toEqual([])
        if (!isSqlError(result.error)) throw new Error("Expected SqlError")
        expect(result.error.reason._tag).toBe("LockTimeoutError")
      } finally {
        if (holder.inTransaction) holder.run("ROLLBACK")
        holder.close()
      }
    })

    test("rolls back a failed COMMIT before the connection is reused", async () => {
      const result = await run(":memory:", (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`PRAGMA foreign_keys = ON`)
          yield* db.run(sql`CREATE TABLE parent (id integer PRIMARY KEY)`)
          yield* db.run(sql`CREATE TABLE item (
            id integer PRIMARY KEY,
            name text NOT NULL,
            parent_id integer REFERENCES parent (id) DEFERRABLE INITIALLY DEFERRED
          )`)
          // The deferred foreign key only fails at COMMIT, which leaves SQLite's transaction open.
          const error = yield* db
            .transaction((tx) => tx.run(sql`INSERT INTO item (name, parent_id) VALUES ('orphan', 1)`))
            .pipe(Effect.flip)
          yield* db.transaction((tx) => tx.run(sql`INSERT INTO item (name) VALUES ('next')`))
          return { error, names: yield* names(db) }
        }),
      )
      expect(isSqlError(result.error)).toBe(true)
      expect(result.names).toEqual(["next"])
    })
  })
}
