export * as CommandActions from "./command-actions"

import { Schema } from "effect"

/**
 * What the Command Centre agent did to other threads on the user's behalf: a message sent, a thread
 * stopped, a thread started. The log is a short, newest-first list the Command Centre page shows as
 * "Done on your behalf"; `CommandActionLog` keeps it in the Command Centre's folder. Only the agent's own
 * actions are recorded, never the user's.
 */
export const Action = Schema.Struct({
  id: Schema.String,
  /** Epoch milliseconds. */
  at: Schema.Number,
  kind: Schema.Literals(["message", "stop", "start"]),
  sessionID: Schema.String,
  title: Schema.String,
  project: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  /** The Command Centre thread that acted. */
  by: Schema.String,
})
export type Action = typeof Action.Type

export const LIMIT = 200
export const TEXT_LIMIT = 500

/** The log with `action` first, at most `LIMIT` long and its text cut to `TEXT_LIMIT`. */
export function append(log: ReadonlyArray<Action>, action: Action): Action[] {
  const text = action.text === undefined ? undefined : action.text.slice(0, TEXT_LIMIT)
  return [text === undefined ? action : { ...action, text }, ...log].slice(0, LIMIT)
}

/** The actions at or after `from`, in the log's order. */
export function since(log: ReadonlyArray<Action>, from: number): Action[] {
  return log.filter((action) => action.at >= from)
}
