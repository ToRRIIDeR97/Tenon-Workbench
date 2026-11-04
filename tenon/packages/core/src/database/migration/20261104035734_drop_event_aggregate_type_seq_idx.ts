import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261104035734_drop_event_aggregate_type_seq_idx",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`event_aggregate_type_seq_idx\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
