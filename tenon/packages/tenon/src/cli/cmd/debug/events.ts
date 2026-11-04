import { Database } from "@tenon/core/database/database"
import { EOL } from "os"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../../effect-cmd"

export const EventsCommand = effectCmd({
  command: "events",
  describe: "report event rows and bytes per type",
  instance: false,
  handler: Effect.fn("Cli.debug.events")(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db
      .all<{
        type: string
        rows: number
        bytes: number
      }>(
        sql`SELECT type, count(*) AS rows, sum(length(CAST(data AS BLOB))) AS bytes FROM event GROUP BY type ORDER BY bytes DESC`,
      )
      .pipe(Effect.orDie)
    const lines = rows.map((row) => [row.type, row.rows, row.bytes].join("\t"))
    process.stdout.write(["type\trows\tbytes", ...lines].join(EOL) + EOL)
  }),
})
