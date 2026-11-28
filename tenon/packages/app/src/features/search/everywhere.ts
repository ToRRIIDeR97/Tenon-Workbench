import type { ServerConnection } from "@/context/server"
import { sessionHref } from "@/utils/session-route"
import type { SearchEverywhere } from "@/features/second-brain/client"

export type EverywhereGroup = "pages" | "tasks" | "events" | "threads"

export type EverywhereLink = {
  key: string
  group: EverywhereGroup
  id: string
  title: string
  detail: string
  href: string
  directory?: string
}

export const EVERYWHERE_MIN = 2

export function shouldSearchEverywhere(query: string) {
  return query.trim().length >= EVERYWHERE_MIN
}

export function everywhereLinks(result: SearchEverywhere, server: string): EverywhereLink[] {
  return [
    ...result.pages.map((page) => ({
      key: `page:${page.path}`,
      group: "pages" as const,
      id: page.path,
      title: page.title,
      detail: page.snippet,
      href: `/projects?page=${encodeURIComponent(page.path)}`,
    })),
    ...result.tasks.map((task) => ({
      key: `task:${task.id}`,
      group: "tasks" as const,
      id: task.id,
      title: task.title,
      detail: task.snippet,
      href: `/calendar?task=${encodeURIComponent(task.id)}`,
    })),
    ...result.events.map((event) => ({
      key: `event:${event.id}`,
      group: "events" as const,
      id: event.id,
      title: event.title,
      detail: event.snippet,
      href: `/calendar?event=${encodeURIComponent(event.id)}&date=${encodeURIComponent(event.date)}`,
    })),
    ...result.threads.map((thread) => ({
      key: `session:${server}:${thread.id}`,
      group: "threads" as const,
      id: thread.id,
      title: thread.title,
      detail: thread.snippet,
      href: sessionHref(server as ServerConnection.Key, thread.id),
      directory: thread.directory,
    })),
  ]
}
