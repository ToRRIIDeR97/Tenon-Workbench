import { describe, expect, test } from "bun:test"
import { dueReminders, type ReminderSettings } from "./reminders"

const settings: ReminderSettings = { enabled: true, eventLeadMinutes: 10, taskTime: "09:00" }
const event = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Event ${id}`,
  date: "2026-11-28",
  start,
  source: "local" as const,
  syncState: "local" as const,
  ...extra,
})
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  source: "local" as const,
  syncState: "local" as const,
  ...extra,
})

describe("AC-16 dueReminders", () => {
  test("an event starting within the lead time reminds once", () => {
    const now = new Date(2026, 10, 28, 9, 52)
    const snapshot = { events: [event("e1", "10:00"), event("e2", "10:30")], tasks: [] }
    const first = dueReminders({ snapshot, now, settings, fired: new Set() })
    expect(first.map((item) => item.kind + ":" + item.title)).toEqual(["event:Event e1"])
    expect(dueReminders({ snapshot, now, settings, fired: new Set(first.map((item) => item.key)) })).toEqual([])
  })

  test("all-day, started and deleted events do not remind", () => {
    const now = new Date(2026, 10, 28, 9, 55)
    const snapshot = {
      events: [
        event("allday", "10:00", { allDay: true }),
        event("started", "09:50"),
        event("deleted", "10:00", { outboxKind: "delete" }),
      ],
      tasks: [],
    }
    expect(dueReminders({ snapshot, now, settings, fired: new Set() })).toEqual([])
  })

  test("open tasks due or scheduled today remind after the task time", () => {
    const snapshot = {
      events: [],
      tasks: [
        task("due", { dueDate: "2026-11-28" }),
        task("scheduled", { scheduledDate: "2026-11-28" }),
        task("done", { dueDate: "2026-11-28", completedAt: "2026-11-28T07:00:00.000Z" }),
        task("tomorrow", { dueDate: "2026-11-29" }),
      ],
    }
    expect(dueReminders({ snapshot, now: new Date(2026, 10, 28, 8, 59), settings, fired: new Set() })).toEqual([])
    expect(
      dueReminders({ snapshot, now: new Date(2026, 10, 28, 9, 0), settings, fired: new Set() }).map(
        (item) => item.title,
      ),
    ).toEqual(["Task due", "Task scheduled"])
  })

  test("disabled reminders return nothing", () => {
    const snapshot = { events: [event("e1", "10:00")], tasks: [task("t", { dueDate: "2026-11-28" })] }
    expect(
      dueReminders({
        snapshot,
        now: new Date(2026, 10, 28, 9, 55),
        settings: { ...settings, enabled: false },
        fired: new Set(),
      }),
    ).toEqual([])
  })
})
