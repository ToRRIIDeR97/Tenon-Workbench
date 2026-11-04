import type { TimelineItem, VaultPageInfo } from "./client"

const day = 86_400_000
const week = 7 * day

export type TimelineRow = {
  item: TimelineItem
  /** Percent of the visible range; absent when the item has no valid date. */
  left?: number
  width?: number
}

/**
 * Lay items out on a grid of whole weeks (starting Monday, UTC calendar days so the time zone never shifts a
 * date). A task spans start..end inclusive; a milestone sits at its date. Dates are `YYYY-MM-DD`.
 */
export function timelineLayout(items: ReadonlyArray<TimelineItem>) {
  const spans = items.map((item) => {
    const start = calendarDay(item.start) ?? calendarDay(item.end)
    const end = calendarDay(item.end) ?? start
    return { item, start, end: start === undefined || end === undefined ? undefined : Math.max(start, end) }
  })
  const starts = spans.flatMap((span) => (span.start === undefined ? [] : [span.start]))
  const ends = spans.flatMap((span) => (span.end === undefined ? [] : [span.end]))
  if (starts.length === 0) return { weeks: [] as string[], rows: items.map((item): TimelineRow => ({ item })) }
  const min = Math.min(...starts)
  const first = min - ((new Date(min).getUTCDay() + 6) % 7) * day
  const count = Math.max(1, Math.ceil((Math.max(...ends) + day - first) / week))
  const total = count * week
  return {
    weeks: Array.from({ length: count }, (_, index) => new Date(first + index * week).toISOString().slice(0, 10)),
    rows: spans.map((span): TimelineRow => {
      if (span.start === undefined || span.end === undefined) return { item: span.item }
      return {
        item: span.item,
        left: ((span.start - first) / total) * 100,
        width: span.item.kind === "milestone" ? 0 : ((span.end + day - span.start) / total) * 100,
      }
    }),
  }
}

/** Progress counts tasks only; milestones mark dates. */
export function timelineCounts(items: ReadonlyArray<TimelineItem>) {
  const tasks = items.filter((item) => item.kind === "task")
  const next = items
    .filter((item) => item.kind === "milestone" && item.status !== "done")
    .sort((left, right) => (left.start ?? "￿").localeCompare(right.start ?? "￿"))[0]
  return { done: tasks.filter((item) => item.status === "done").length, total: tasks.length, next }
}

/**
 * A month (`YYYY-MM`) as whole weeks from Monday, each day with the items on it: a task on every day from its
 * start to its end, a milestone on its date. UTC calendar days, like `timelineLayout`.
 */
export function monthGrid(month: string, items: ReadonlyArray<TimelineItem>) {
  const first = calendarDay(`${month}-01`) ?? calendarDay(new Date().toISOString())!
  const start = first - ((new Date(first).getUTCDay() + 6) % 7) * day
  const next = new Date(first)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const count = Math.ceil((next.getTime() - start) / week)
  const spans = items.flatMap((item) => {
    const from = calendarDay(item.start) ?? calendarDay(item.end)
    if (from === undefined) return []
    const to = item.kind === "milestone" ? from : Math.max(from, calendarDay(item.end) ?? from)
    return [{ item, from, to }]
  })
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: 7 }, (_, column) => {
      const time = start + (row * 7 + column) * day
      return {
        date: new Date(time).toISOString().slice(0, 10),
        inMonth: time >= first && time < next.getTime(),
        items: spans.filter((span) => span.from <= time && time <= span.to).map((span) => span.item),
      }
    }),
  )
}

/** `YYYY-MM` moved by `offset` months. */
export function shiftMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 7)
}

/**
 * A free file name for a new page among the existing paths, e.g. `Untitled 2.md`. Strips characters paths refuse;
 * a title with nothing left falls back to `page`, a plain slug that needs no translation.
 */
export function newPagePath(title: string, folder: string, pages: ReadonlyArray<Pick<VaultPageInfo, "path">>) {
  const base = title.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "").trim() || "page"
  const taken = new Set(pages.map((page) => page.path.toLowerCase()))
  const prefix = folder ? `${folder}/` : ""
  const name = (index: number) => (index === 1 ? `${base}.md` : `${base} ${index}.md`)
  const index = Array.from({ length: 1000 }, (_, offset) => offset + 1).find(
    (candidate) => !taken.has(`${prefix}${name(candidate)}`.toLowerCase()),
  )
  return name(index ?? Date.now())
}

/**
 * The text a page keeps after a save. The server ends the file with a newline, and that alone must not replace the
 * text in the editor: a new value would read as a loaded page, dropping the caret and switching to Preview. Text
 * typed while the request ran stays unsaved.
 */
export function bodyAfterSave(current: string, sent: string, saved: string) {
  const baseBody = saved.trimEnd() === sent.trimEnd() ? sent : saved
  return { body: current === sent ? baseBody : current, baseBody }
}

/** The change that gives an item its date: a task's due day (its end), a milestone's day (its start). */
export function dueDatePatch(item: TimelineItem, date: string | undefined): Partial<TimelineItem> {
  if (item.kind === "milestone") return { start: date }
  if (!date) return { start: undefined, end: undefined }
  return item.start && item.start.slice(0, 10) > date ? { start: undefined, end: date } : { end: date }
}

/** Puts a removed item back near where it was, in the latest list; one that came back meanwhile stays as it is. */
export function restoreItem(items: ReadonlyArray<TimelineItem>, item: TimelineItem, index: number) {
  if (items.some((entry) => entry.id === item.id)) return items
  return [...items.slice(0, index), item, ...items.slice(index)]
}

/** Projects whose name or outcome holds `query`, ignoring case. */
export function matchProjects<T extends { name: string; outcome: string }>(projects: ReadonlyArray<T>, query: string) {
  const text = query.trim().toLowerCase()
  if (!text) return []
  return projects.filter((project) => `${project.name}\n${project.outcome}`.toLowerCase().includes(text))
}

function calendarDay(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return undefined
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(time) ? time : undefined
}
