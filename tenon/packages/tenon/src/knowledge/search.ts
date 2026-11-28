export * as KnowledgeSearch from "./search"

import { Schema } from "effect"
import type { PlannerCalendar } from "@/planner/calendar"
import { KnowledgeVault } from "./vault"
import { WikiLinks } from "./wiki-links"

export const DEFAULT_LIMIT = 8
export const MAX_LIMIT = 50

export const TaskHit = Schema.Struct({ id: Schema.String, title: Schema.String, snippet: Schema.String })
export const EventHit = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  date: Schema.String,
  snippet: Schema.String,
})
export const ThreadHit = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  snippet: Schema.String,
  updated: Schema.Number,
})
export const Result = Schema.Struct({
  pages: Schema.Array(KnowledgeVault.PageSearchHit),
  tasks: Schema.Array(TaskHit),
  events: Schema.Array(EventHit),
  threads: Schema.Array(ThreadHit),
})
export type Result = typeof Result.Type

export const empty: Result = { pages: [], tasks: [], events: [], threads: [] }

export function validQuery(query: string) {
  return query.trim().length >= 2
}

export function limitOf(value: string | undefined) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? Math.min(number, MAX_LIMIT) : DEFAULT_LIMIT
}

function hit(texts: ReadonlyArray<string | undefined>, needle: string) {
  for (const text of texts) {
    if (!text) continue
    const index = text.toLowerCase().indexOf(needle)
    if (index >= 0) return WikiLinks.snippet(text, index, needle.length)
  }
  return undefined
}

export function calendar(
  snapshot: { events: ReadonlyArray<PlannerCalendar.Event>; tasks: ReadonlyArray<PlannerCalendar.Task> },
  query: string,
  limit: number,
) {
  const needle = query.trim().toLowerCase()
  if (!needle) return { events: [], tasks: [] }
  const events = snapshot.events
    .filter((event) => event.outboxKind !== "delete")
    .flatMap((event) => {
      const snippet = hit([event.title, event.details], needle)
      return snippet === undefined ? [] : [{ id: event.id, title: event.title, date: event.date, snippet }]
    })
    .slice(0, limit)
  const tasks = snapshot.tasks
    .filter((task) => task.outboxKind !== "delete")
    .flatMap((task) => {
      const snippet = hit([task.title, task.notes], needle)
      return snippet === undefined ? [] : [{ id: task.id, title: task.title, snippet }]
    })
    .slice(0, limit)
  return { events, tasks }
}
