import { createResource, createSignal } from "solid-js"
import { readCalendar, type CalendarSnapshot } from "./client"

type Client = Parameters<typeof readCalendar>[0]

const PREFIX = "tenon.calendar-cache:"
const memory = new Map<string, CalendarSnapshot>()

/**
 * The workspace calendar, shown from the last snapshot while a fresh read is in flight. A launch paints the
 * cached events at once and a background refetch (Google sync, focus) swaps items in place instead of
 * blanking the view. A local write (`mutate`) shows at once, even mid-read, and a read that started before
 * it never overwrites it. A failed refresh keeps the last snapshot; `error` says it failed. The cache is
 * rebuildable: a missing or unreadable entry only means a cold first paint.
 */
export function createCalendarResource(source: () => string | undefined, client: (directory: string) => Client) {
  // The newest snapshot of a workspace from a read or a local write, whichever came last.
  const [shown, setShown] = createSignal<{ directory: string; snapshot: CalendarSnapshot }>()
  const writes = { count: 0 }
  const [calendar, actions] = createResource(source, async (directory) => {
    const started = writes.count
    const snapshot = await readCalendar(client(directory))
    // A local write since this read started is newer than what the read returned.
    if (writes.count !== started) return remembered(directory) ?? snapshot
    remember(directory, snapshot)
    setShown({ directory, snapshot })
    return snapshot
  })
  // `shown` can still hold the previous workspace while a switch loads, so that reads this one's cache.
  const snapshot = () => {
    const directory = source()
    if (!directory) return undefined
    const current = shown()
    if (current?.directory === directory) return current.snapshot
    return remembered(directory)
  }
  return {
    snapshot,
    /** True only when there is nothing to show yet: a cold first load with no cached snapshot. */
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
  } catch {
    // A full or blocked storage only costs the next launch its instant paint.
  }
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
