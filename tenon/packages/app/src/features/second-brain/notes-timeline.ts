import type { TimelineItem, VaultPageInfo } from "./client"

const day = 86_400_000
const week = 7 * day
const MIN_WEEKS = 4

export type TimelineRow = {
  item: TimelineItem
  left?: number
  width?: number
}

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
  const count = Math.max(MIN_WEEKS, Math.ceil((Math.max(...ends) + day - first) / week))
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

export function timelineCounts(items: ReadonlyArray<TimelineItem>) {
  const tasks = items.filter((item) => item.kind === "task")
  const done = tasks.filter((item) => item.status === "done").length
  const next = milestoneGroups(items)
    .flatMap((group) => (group.milestone && !group.complete ? [group.milestone] : []))
    .sort((left, right) => (left.start ?? "￿").localeCompare(right.start ?? "￿"))[0]
  return {
    done,
    total: tasks.length,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : undefined,
    next,
  }
}

export function milestoneStatus(group: MilestoneGroup): TimelineItem["status"] | undefined {
  if (!group.milestone) return undefined
  return group.complete ? "done" : group.milestone.status
}

export type MilestoneGroup = {
  milestone?: TimelineItem
  tasks: TimelineItem[]
  done: number
  total: number
  complete: boolean
}

export function milestoneGroups(items: ReadonlyArray<TimelineItem>, open = false) {
  const groups: MilestoneGroup[] = [{ tasks: [], done: 0, total: 0, complete: false }]
  items.forEach((item) => {
    if (item.kind === "milestone")
      return void groups.push({ milestone: item, tasks: [], done: 0, total: 0, complete: false })
    const group = groups.at(-1)!
    group.total += 1
    if (item.status === "done") group.done += 1
    if (!open || item.status !== "done") group.tasks.push(item)
  })
  groups.forEach((group) => {
    group.complete = group.milestone?.status === "done" || (group.total > 0 && group.done === group.total)
  })
  return groups.filter((group) =>
    group.milestone ? !open || !group.complete || group.tasks.length > 0 : group.tasks.length > 0,
  )
}

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

export function shiftMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 7)
}

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

export function bodyAfterSave(current: string, sent: string, saved: string) {
  const baseBody = saved.trimEnd() === sent.trimEnd() ? sent : saved
  return { body: current === sent ? baseBody : current, baseBody }
}

export function dueDatePatch(item: TimelineItem, date: string | undefined): Partial<TimelineItem> {
  if (item.kind === "milestone") return { start: date }
  if (!date) return { start: undefined, end: undefined }
  return item.start && item.start.slice(0, 10) > date ? { start: undefined, end: date } : { end: date }
}

export function restoreItem(items: ReadonlyArray<TimelineItem>, item: TimelineItem, index: number) {
  if (items.some((entry) => entry.id === item.id)) return items
  return [...items.slice(0, index), item, ...items.slice(index)]
}

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
