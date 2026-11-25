import type { LogEntry, TimelineItem } from "./client"
import { milestoneGroups } from "./notes-timeline"

export type RoadStop = {
  id: string
  title: string
  date?: string
  state: "done" | "current" | "ahead"
  done: number
  total: number
}

export type MilestoneRoad = {
  stops: RoadStop[]
  positions: number[]
  fill: number
  current?: RoadStop
}

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
      updated: number
      running: boolean
    }
  | {
      kind: "log"
      key: string
      at: number
      dateOnly: boolean
      author: string
      text: string
    }

export type StoryDay = {
  day: string
  key: string
  daysAgo: number
  entries: StoryEntry[]
}

export function projectStory(
  threads: ReadonlyArray<{ id: string; title: string; updated: number; running: boolean }>,
  log: ReadonlyArray<LogEntry>,
  now: number,
): StoryDay[] {
  const seen = new Map<string, number>()
  const entries: StoryEntry[] = [
    ...threads.flatMap((thread): StoryEntry[] => {
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

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
function logTime(value: string) {
  const date = DATE_ONLY.exec(value)
  if (date) return new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3])).getTime()
  return Date.parse(value)
}

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
