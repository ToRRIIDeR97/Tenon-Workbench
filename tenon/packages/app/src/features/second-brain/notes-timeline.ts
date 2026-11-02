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

/** A free file name for a new page among the existing paths, e.g. `Untitled 2.md`. Strips characters paths refuse. */
export function newPagePath(title: string, folder: string, pages: ReadonlyArray<Pick<VaultPageInfo, "path">>) {
  const base = title.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "").trim() || "Untitled"
  const taken = new Set(pages.map((page) => page.path.toLowerCase()))
  const prefix = folder ? `${folder}/` : ""
  const name = (index: number) => (index === 1 ? `${base}.md` : `${base} ${index}.md`)
  const index = Array.from({ length: 1000 }, (_, offset) => offset + 1).find(
    (candidate) => !taken.has(`${prefix}${name(candidate)}`.toLowerCase()),
  )
  return name(index ?? Date.now())
}

function calendarDay(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return undefined
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(time) ? time : undefined
}
