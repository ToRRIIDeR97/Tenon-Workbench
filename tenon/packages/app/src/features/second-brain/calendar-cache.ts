import { createResource, createSignal } from "solid-js"
import { readCalendar, type CalendarSnapshot } from "./client"

type Client = Parameters<typeof readCalendar>[0]

const PREFIX = "tenon.calendar-cache:"
const memory = new Map<string, CalendarSnapshot>()

export function createCalendarResource(source: () => string | undefined, client: (directory: string) => Client) {
  const [shown, setShown] = createSignal<{ directory: string; snapshot: CalendarSnapshot }>()
  const writes = { count: 0 }
  const [calendar, actions] = createResource(source, async (directory) => {
    const started = writes.count
    const snapshot = await readCalendar(client(directory))
    if (writes.count !== started) return remembered(directory) ?? snapshot
    remember(directory, snapshot)
    setShown({ directory, snapshot })
    return snapshot
  })
  const snapshot = () => {
    const directory = source()
    if (!directory) return undefined
    const current = shown()
    if (current?.directory === directory) return current.snapshot
    return remembered(directory)
  }
  return {
    snapshot,
    loading: () => !calendar.error && !snapshot(),
    error: () => calendar.error as unknown,
    refetch: () => actions.refetch(),
    mutate: (next: CalendarSnapshot) => {
      const directory = source()
      if (!directory) return
      writes.count += 1
      remember(directory, next)
      setShown({ directory, snapshot: next })
      actions.mutate(next)
    },
  }
}

function remembered(directory: string) {
  const cached = memory.get(directory)
  if (cached) return cached
  const stored = read(directory)
  if (stored) memory.set(directory, stored)
  return stored
}

function remember(directory: string, snapshot: CalendarSnapshot) {
  memory.set(directory, snapshot)
  try {
    localStorage.setItem(PREFIX + directory, JSON.stringify(snapshot))
  } catch {}
}

function read(directory: string) {
  try {
    const raw = localStorage.getItem(PREFIX + directory)
    if (!raw) return undefined
    const value = JSON.parse(raw) as CalendarSnapshot
    return Array.isArray(value?.events) && Array.isArray(value?.tasks) ? value : undefined
  } catch {
    return undefined
  }
}
