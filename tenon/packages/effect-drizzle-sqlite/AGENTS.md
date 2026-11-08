# Effect Drizzle SQLite

This package adapts Drizzle's Effect SQLite query builders to a generic Effect `SqlClient`.

- Keep this package generic: Drizzle + Effect + SQLite only.
- Do not add Tenon-specific tables, paths, migrations, post-commit hooks, or domain storage APIs here.
- Runtime code should depend on generic `effect/sql/SqlClient`, not a specific SQLite driver.
- Concrete SQLite clients such as `@effect/sql-sqlite-bun` belong in tests or examples unless this package intentionally adds a driver-specific helper.
- The query builders, prepared query, transaction base class and migrator come from `drizzle-orm/sqlite-core/effect`
  (drizzle-orm 1.0.0-rc.5). Only the driver and session live here, because upstream's `drizzle-orm/effect-sqlite-bun`
  and `-node` drivers require their own `@effect/sql-sqlite-*` client services, while core provides its own `SqlClient`.
  Keep `driver.ts` and `session.ts` close to upstream's `effect-sqlite-bun` driver so the package can be retired when
  upstream accepts a generic client.
- Transactions go through `SqlClient.withTransaction`; `{ behavior }` only picks the top-level `BEGIN` through
  `SqlClient.BeginTransaction`.
- If touching Effect APIs, verify against the installed `effect` sources (`node_modules/effect/src`).

Useful entry points:

- `src/effect-sqlite/driver.ts`: creates the Effect-backed Drizzle database with `make` and `makeWithDefaults`.
- `src/effect-sqlite/session.ts`: adapts generic Effect `SqlClient` execution and transactions to Drizzle SQLite sessions.
- `examples/basic.ts`: minimal usage example with Bun SQLite.
