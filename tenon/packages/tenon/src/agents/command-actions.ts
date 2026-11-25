export * as CommandActions from "./command-actions"

import { Schema } from "effect"

export const Action = Schema.Struct({
  id: Schema.String,
  at: Schema.Number,
  kind: Schema.Literals(["message", "stop", "start"]),
  sessionID: Schema.String,
  title: Schema.String,
  project: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  by: Schema.String,
})
export type Action = typeof Action.Type

export const LIMIT = 200
export const TEXT_LIMIT = 500

export function append(log: ReadonlyArray<Action>, action: Action): Action[] {
  const text = action.text === undefined ? undefined : action.text.slice(0, TEXT_LIMIT)
  return [text === undefined ? action : { ...action, text }, ...log].slice(0, LIMIT)
}

export function since(log: ReadonlyArray<Action>, from: number): Action[] {
  return log.filter((action) => action.at >= from)
}
