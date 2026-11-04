export * as Database from "./database"

import { EffectDrizzleSqlite } from "@tenon/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { existsSync, renameSync } from "fs"
import { chmod } from "fs/promises"
import { basename, dirname, isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@tenon/v2/storage/Database") {}

const layer = (filename: string) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const db = yield* makeDatabase

      // The driver opens the connection with the busy timeout and WAL journal mode already set.
      yield* db.run("PRAGMA synchronous = NORMAL")
      yield* db.run("PRAGMA cache_size = -64000")
      yield* db.run("PRAGMA foreign_keys = ON")
      yield* db.run("PRAGMA journal_size_limit = 67108864")
      yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
      yield* restrictPermissions(filename)
      yield* DatabaseMigration.apply(db)
      // Keeps planner statistics current. analysis_limit bounds the blocking scan on a large database, and a second
      // server process holding the write lock only defers this to the next start.
      yield* db.run("PRAGMA analysis_limit = 1000")
      yield* db.run("PRAGMA optimize = 0x10002").pipe(Effect.ignore)

      return { db }
    }).pipe(Effect.orDie),
  )

export function layerFromPath(filename: string) {
  return layer(filename).pipe(
    Layer.provide(
      Layer.unwrap(
        Effect.sync(() => {
          adoptLegacyFile(filename)
          return sqliteLayer({ filename, timeout: 5000 })
        }),
      ),
    ),
  )
}

/**
 * Databases created before the rename are named `opencode*.db`. When `filename` is a `tenon*.db`
 * that does not exist yet, move the matching legacy file (and its -wal/-shm, first, so a crash
 * cannot separate committed pages from the database) into place before it is opened.
 */
export function adoptLegacyFile(filename: string) {
  const name = basename(filename)
  if (filename === ":memory:" || !name.startsWith("tenon") || existsSync(filename)) return
  const legacy = join(dirname(filename), `opencode${name.slice("tenon".length)}`)
  if (!existsSync(legacy)) return
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(legacy + suffix) && !existsSync(filename + suffix)) renameSync(legacy + suffix, filename + suffix)
  }
  renameSync(legacy, filename)
}

// The database stores provider credentials. SQLite creates the -wal and -shm files with the
// database file's mode, but files left by an older build may still be world-readable.
function restrictPermissions(filename: string) {
  if (filename === ":memory:" || process.platform === "win32") return Effect.void
  return Effect.promise(() =>
    Promise.all(["", "-wal", "-shm"].map((suffix) => chmod(filename + suffix, 0o600).catch(() => undefined))),
  )
}

export function path() {
  if (Flag.TENON_DB) {
    if (Flag.TENON_DB === ":memory:" || isAbsolute(Flag.TENON_DB)) return Flag.TENON_DB
    return join(Global.Path.data, Flag.TENON_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.TENON_DISABLE_CHANNEL_DB === "1" ||
    process.env.TENON_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, "tenon.db")
  return join(Global.Path.data, `tenon-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
