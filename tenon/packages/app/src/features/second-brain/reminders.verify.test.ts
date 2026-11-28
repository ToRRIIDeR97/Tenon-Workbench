import { describe, expect, test } from "bun:test"
import { dueReminders, reminderSettings } from "./reminders"

const base = { source: "local" as const, syncState: "local" as const }

describe("AC-16 reminders (verification)", () => {
  test("an event exactly at the lead boundary reminds; one minute before it does not", () => {
    const snapshot = { events: [{ ...base, id: "e", title: "E", date: "2026-11-28", start: "10:00" }], tasks: [] }
    const settings = { enabled: true, eventLeadMinutes: 15, taskTime: "09:00" }
    expect(dueReminders({ snapshot, now: new Date(2026, 10, 28, 9, 44), settings, fired: new Set() })).toEqual([])
    expect(dueReminders({ snapshot, now: new Date(2026, 10, 28, 9, 45), settings, fired: new Set() }).length).toBe(1)
  })

  test("an event on another day does not remind even at the same clock time", () => {
    const snapshot = { events: [{ ...base, id: "e", title: "E", date: "2026-11-29", start: "10:00" }], tasks: [] }
    const settings = { enabled: true, eventLeadMinutes: 10, taskTime: "09:00" }
    expect(dueReminders({ snapshot, now: new Date(2026, 10, 28, 9, 55), settings, fired: new Set() })).toEqual([])
  })

  test("a task reminder key is per day, so it can remind again on its next due day", () => {
    const task = {
      ...base,
      id: "t",
      title: "T",
      dueDate: "2026-11-28",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    }
    const settings = { enabled: true, eventLeadMinutes: 10, taskTime: "08:00" }
    const today = dueReminders({
      snapshot: { events: [], tasks: [task] },
      now: new Date(2026, 10, 28, 12),
      settings,
      fired: new Set(),
    })
    const tomorrow = dueReminders({
      snapshot: { events: [], tasks: [{ ...task, dueDate: "2026-11-29" }] },
      now: new Date(2026, 10, 29, 12),
      settings,
      fired: new Set(today.map((item) => item.key)),
    })
    expect(tomorrow.length).toBe(1)
    expect(tomorrow[0]!.key).not.toBe(today[0]!.key)
  })

  test("settings fill defaults and clamp bad values", () => {
    expect(reminderSettings(undefined)).toEqual({ enabled: true, eventLeadMinutes: 10, taskTime: "09:00" })
    expect(reminderSettings({ enabled: false, eventLeadMinutes: -5, taskTime: "25:99" })).toEqual({
      enabled: false,
      eventLeadMinutes: 0,
      taskTime: "09:00",
    })
    expect(reminderSettings({ eventLeadMinutes: 9999 }).eventLeadMinutes).toBe(1440)
  })
})
