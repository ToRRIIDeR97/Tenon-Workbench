import type { LogEntry, TimelineItem } from "./client"
import { milestoneGroups } from "./notes-timeline"

/**
 * The Project page's derived views: the milestone road under the title, the numbers row and the Story that merges
 * threads with the Project log. Pure, so the page and its tests read the same answers.
 */

export type RoadStop = {
  id: string
  title: string
  /** The milestone's date (its start, else its end), as stored. */
  date?: string
  /** Done when marked done or every task under it is; the first other stop is current; the rest are ahead. */
  state: "done" | "current" | "ahead"
  done: number
  total: number
}

export type MilestoneRoad = {
  stops: RoadStop[]
  /** Where each stop sits along the road, 0–1. The road starts before the first stop, so stop i of n sits at (i+1)/n. */
  positions: number[]
  /** How far along the road the fill reaches, 0–1. */
  fill: number
  current?: RoadStop
}

/**
 * The milestones in list order, as stops along a road that starts before the first of them. The fill runs through
 * every finished milestone and on toward the current one by the share of its tasks that are done, so progress on
 * the first milestone shows too.
 */
export function milestoneRoad(items: ReadonlyArray<TimelineItem>): MilestoneRoad {
  const groups = milestoneGroups(items).filter((group) => group.milestone)
  const firstOpen = groups.findIndex((group) => !group.complete)
  const stops: RoadStop[] = groups.map((group, index) => ({
    id: group.milestone!.id,
    title: group.milestone!.title,
    date: group.milestone!.start ?? group.milestone!.end,
    state: group.complete ? "done" : index === firstOpen ? "current" : "ahead",
    done: group.done,
    total: group.total,
  }))
  const count = stops.length
  const current = firstOpen === -1 ? undefined : stops[firstOpen]
  const share = current && current.total > 0 ? current.done / current.total : 0
  return {
    stops,
    positions: stops.map((_, index) => (index + 1) / count),
    fill: count === 0 ? 0 : current ? (firstOpen + share) / count : 1,
    current,
  }
}

export type ProjectNumbers = { open: number; done: number; running: number; pages: number }

/** The numbers row: open and done tasks (milestones aside), threads at work, and pages. */
export function projectNumbers(
  items: ReadonlyArray<TimelineItem>,
  threads: ReadonlyArray<{ running: boolean }>,
  pages: number,
): ProjectNumbers {
  const tasks = items.filter((item) => item.kind === "task")
  const done = tasks.filter((item) => item.status === "done").length
  return {
    open: tasks.length - done,
    done,
    running: threads.filter((thread) => thread.running).length,
    pages,
  }
}

export type StoryEntry =
  | {
      kind: "thread"
      key: string
      id: string
      title: string
      at: number
      /** The thread's own last update; `at` is now for a running thread. */
      updated: number
      running: boolean
    }
  | {
      kind: "log"
      key: string
      at: number
      /** Stamped with a day but no time. */
      dateOnly: boolean
      author: string
      text: string
    }

export type StoryDay = {
  /** The local calendar day, `YYYY-MM-DD`. */
  day: string
  /** Stable across updates: `day:` and the day. */
  key: string
  /** 0 for today, 1 for yesterday, and so on. */
  daysAgo: number
  entries: StoryEntry[]
}

/**
 * Threads and log entries on one timeline, grouped by local day, newest day first. Running threads lead today
 * whatever their last update, the most recently active first; otherwise entries are newest first. Anything stamped after `now` (another machine's
 * clock) counts as today. Log entries whose time does not parse, and stopped threads without a valid time, are left
 * out. Entries carry stable keys so a renderer can keep them across updates.
 */
export function projectStory(
  threads: ReadonlyArray<{ id: string; title: string; updated: number; running: boolean }>,
  log: ReadonlyArray<LogEntry>,
  now: number,
): StoryDay[] {
  const seen = new Map<string, number>()
  const entries: StoryEntry[] = [
    ...threads.flatMap((thread): StoryEntry[] => {
      // A stopped thread needs a real time to be placed; zero or less is as missing as NaN.
      if (!thread.running && !(Number.isFinite(thread.updated) && thread.updated > 0)) return []
      return [
        {
          kind: "thread",
          key: `thread:${thread.id}`,
          id: thread.id,
          title: thread.title,
          at: thread.running ? now : Math.min(thread.updated, now),
          updated: thread.updated,
          running: thread.running,
        },
      ]
    }),
    ...log.flatMap((entry): StoryEntry[] => {
      const at = logTime(entry.at)
      if (!Number.isFinite(at)) return []
      // Keyed by what the entry says, not where it sits, so a new entry at either end leaves the others' keys alone.
      const base = `log:${entry.at}:${entry.author}:${textHash(entry.text)}`
      const repeat = (seen.get(base) ?? 0) + 1
      seen.set(base, repeat)
      return [
        {
          kind: "log",
          key: repeat === 1 ? base : `${base}#${repeat}`,
          at: Math.min(at, now),
          dateOnly: DATE_ONLY.test(entry.at),
          author: entry.author,
          text: entry.text,
        },
      ]
    }),
  ]
  const running = (entry: StoryEntry) => entry.kind === "thread" && entry.running
  // Running threads by their own last update (one without a valid time sorts after the others).
  const order = (entry: StoryEntry) =>
    entry.kind === "thread" && entry.running ? (Number.isFinite(entry.updated) ? entry.updated : 0) : entry.at
  entries.sort((left, right) => Number(running(right)) - Number(running(left)) || order(right) - order(left))
  const today = startOfDay(now)
  const days = new Map<string, StoryDay>()
  for (const entry of entries) {
    const key = dayKey(entry.at)
    const day = days.get(key) ?? {
      day: key,
      key: `day:${key}`,
      daysAgo: Math.round((today - startOfDay(entry.at)) / 86_400_000),
      entries: [],
    }
    day.entries.push(entry)
    days.set(key, day)
  }
  return [...days.values()].sort((left, right) => left.daysAgo - right.daysAgo)
}

// A date-only stamp names a local day; `Date.parse` would read it as UTC midnight, the day before west of UTC.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
function logTime(value: string) {
  const date = DATE_ONLY.exec(value)
  if (date) return new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3])).getTime()
  return Date.parse(value)
}

// A short, stable fingerprint of an entry's text (djb2), enough to tell entries with the same time and author apart.
function textHash(text: string) {
  return Array.from(text)
    .reduce((hash, char) => (Math.imul(hash, 33) ^ char.codePointAt(0)!) >>> 0, 5381)
    .toString(36)
}

function dayKey(time: number) {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startOfDay(time: number) {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
