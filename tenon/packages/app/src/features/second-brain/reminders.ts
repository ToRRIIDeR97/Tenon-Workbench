import type { CalendarEvent, PlannerTask } from "./client"
import { localDate } from "./templates"

export type ReminderSettings = { enabled: boolean; eventLeadMinutes: number; taskTime: string }

export type Reminder = {
  key: string
  kind: "event" | "task"
  id: string
  title: string
  date: string
  time?: string
}

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: true, eventLeadMinutes: 10, taskTime: "09:00" }

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export function reminderSettings(value: Partial<ReminderSettings> | undefined): ReminderSettings {
  const minutes = Number(value?.eventLeadMinutes)
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : DEFAULT_REMINDERS.enabled,
    eventLeadMinutes: Number.isFinite(minutes)
      ? Math.min(1440, Math.max(0, Math.round(minutes)))
      : DEFAULT_REMINDERS.eventLeadMinutes,
    taskTime:
      typeof value?.taskTime === "string" && TIME.test(value.taskTime) ? value.taskTime : DEFAULT_REMINDERS.taskTime,
  }
}

function at(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number)
  const match = TIME.exec(time)
  if (!year || !month || !day || !match) return undefined
  return new Date(year, month - 1, day, Number(match[1]), Number(match[2]))
}

export function dueReminders(input: {
  snapshot: { events: ReadonlyArray<CalendarEvent>; tasks: ReadonlyArray<PlannerTask> }
  now: Date
  settings: ReminderSettings
  fired: ReadonlySet<string>
}): Reminder[] {
  if (!input.settings.enabled) return []
  const now = input.now.getTime()
  const lead = input.settings.eventLeadMinutes * 60_000
  const today = localDate(input.now)
  const events = input.snapshot.events.flatMap((event): Reminder[] => {
    if (event.allDay || event.outboxKind === "delete" || !event.start) return []
    const start = at(event.date, event.start)?.getTime()
    if (start === undefined || now >= start || now < start - lead) return []
    const key = `event:${event.id}:${event.date}T${event.start}`
    if (input.fired.has(key)) return []
    return [{ key, kind: "event", id: event.id, title: event.title, date: event.date, time: event.start }]
  })
  const taskAt = at(today, input.settings.taskTime)?.getTime()
  const tasks =
    taskAt === undefined || now < taskAt
      ? []
      : input.snapshot.tasks.flatMap((task): Reminder[] => {
          if (task.completedAt || task.outboxKind === "delete") return []
          if (task.dueDate !== today && task.scheduledDate !== today) return []
          const key = `task:${task.id}:${today}`
          if (input.fired.has(key)) return []
          return [{ key, kind: "task", id: task.id, title: task.title, date: today }]
        })
  return [...events, ...tasks]
}

export function pruneFired(fired: ReadonlyArray<string>, now: Date, keepDays = 3) {
  const cutoff = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - keepDays))
  return fired.filter((key) => {
    const date = /(\d{4}-\d{2}-\d{2})/.exec(key)?.[1]
    return !date || date >= cutoff
  })
}
