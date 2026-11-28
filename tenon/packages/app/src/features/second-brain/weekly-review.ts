import type { CalendarEvent, PlannerTask, ProjectStatus } from "./client"
import { localDate } from "./templates"

const DAY = 24 * 60 * 60 * 1000
const WEEK_DAYS = 7
const STALL_DAYS = 14

export type ReviewThread = { id: string; title: string; updated: number; projectId?: string }
export type ReviewProject = { id: string; name: string; status: ProjectStatus }
export type ReviewPage = { path: string; title: string; projectId: string | null; updatedAt: string }
export type UpcomingItem = { kind: "event" | "task"; id: string; title: string; date: string; time?: string }

export type WeeklyReview = {
  completed: PlannerTask[]
  overdue: PlannerTask[]
  upcoming: UpcomingItem[]
  threads: Array<{ projectId?: string; threads: ReviewThread[] }>
  stalled: ReviewProject[]
  pages: ReviewPage[]
}

const open = (task: PlannerTask) => !task.completedAt && task.outboxKind !== "delete"

export function weeklyReview(input: {
  now: Date
  tasks: ReadonlyArray<PlannerTask>
  events: ReadonlyArray<CalendarEvent>
  threads: ReadonlyArray<ReviewThread>
  projects: ReadonlyArray<ReviewProject>
  pages: ReadonlyArray<ReviewPage>
}): WeeklyReview {
  const now = input.now.getTime()
  const weekAgo = now - WEEK_DAYS * DAY
  const stallSince = now - STALL_DAYS * DAY
  const today = localDate(input.now)
  const horizon = localDate(
    new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate() + WEEK_DAYS, 12),
  )
  const time = (value: string | undefined) => (value ? Date.parse(value) : Number.NaN)

  const completed = input.tasks
    .filter(
      (task) => task.outboxKind !== "delete" && time(task.completedAt) >= weekAgo && time(task.completedAt) <= now,
    )
    .sort((left, right) => time(right.completedAt) - time(left.completedAt))
  const overdue = input.tasks
    .filter((task) => open(task) && !!task.dueDate && task.dueDate < today)
    .sort((left, right) => left.dueDate!.localeCompare(right.dueDate!))
  const upcoming: UpcomingItem[] = [
    ...input.events
      .filter((event) => event.outboxKind !== "delete" && event.date >= today && event.date <= horizon)
      .map(
        (event): UpcomingItem => ({
          kind: "event",
          id: event.id,
          title: event.title,
          date: event.date,
          ...(event.start ? { time: event.start } : {}),
        }),
      ),
    ...input.tasks
      .filter((task) => open(task) && !!task.dueDate && task.dueDate >= today && task.dueDate <= horizon)
      .map((task): UpcomingItem => ({ kind: "task", id: task.id, title: task.title, date: task.dueDate! })),
  ].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      (left.time ?? "").localeCompare(right.time ?? "") ||
      (left.kind === right.kind ? 0 : left.kind === "event" ? -1 : 1),
  )

  const names = new Map(input.projects.map((project) => [project.id, project.name]))
  const recent = input.threads.filter((thread) => thread.updated >= weekAgo)
  const grouped = new Map<string | undefined, ReviewThread[]>()
  for (const thread of recent) {
    const key = thread.projectId && names.has(thread.projectId) ? thread.projectId : undefined
    grouped.set(key, [...(grouped.get(key) ?? []), thread])
  }
  const threads = [...grouped]
    .map(([projectId, list]) => ({
      ...(projectId ? { projectId } : {}),
      threads: list.sort((left, right) => right.updated - left.updated),
    }))
    .sort((left, right) => {
      if (!left.projectId) return 1
      if (!right.projectId) return -1
      return (names.get(left.projectId) ?? "").localeCompare(names.get(right.projectId) ?? "")
    })

  const touched = new Set([
    ...input.threads
      .filter((thread) => thread.updated >= stallSince && thread.projectId)
      .map((thread) => thread.projectId!),
    ...input.pages
      .filter((page) => time(page.updatedAt) >= stallSince && page.projectId)
      .map((page) => page.projectId!),
  ])
  const stalled = input.projects
    .filter((project) => project.status === "active" && !touched.has(project.id))
    .sort((left, right) => left.name.localeCompare(right.name))

  const pages = input.pages
    .filter((page) => time(page.updatedAt) >= weekAgo)
    .sort((left, right) => time(right.updatedAt) - time(left.updatedAt))

  return { completed, overdue, upcoming, threads, stalled, pages }
}
