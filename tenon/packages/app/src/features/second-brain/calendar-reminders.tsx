import { useNavigate } from "@solidjs/router"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { showToast } from "@/utils/toast"
import { readCalendar, type CalendarSnapshot } from "./client"
import { CALENDAR_CHANGED } from "./calendar-cache"
import { dueReminders, pruneFired, reminderSettings, type Reminder } from "./reminders"

const FIRED_KEY = "tenon.reminders.fired.v1"
const CHECK_MS = 30_000
const REFRESH_MS = 5 * 60_000

function readFired() {
  try {
    const value = JSON.parse(localStorage.getItem(FIRED_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function writeFired(keys: ReadonlyArray<string>) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(keys))
  } catch {}
}

export function CalendarReminders() {
  const platform = usePlatform()
  const layout = useLayout()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const language = useLanguage()
  const navigate = useNavigate()
  let snapshot: { directory: string; value: CalendarSnapshot } | undefined
  let loading = false

  const refresh = async () => {
    const directory = layout.home.workspace()
    if (!directory || loading) return
    loading = true
    const value = await readCalendar({
      server: serverSDK().server,
      fetch: platform.fetch,
      target: { directory },
    }).catch(() => undefined)
    loading = false
    if (value) snapshot = { directory, value }
  }

  const open = (reminder: Reminder) =>
    navigate(
      reminder.kind === "event"
        ? `/calendar?event=${encodeURIComponent(reminder.id)}&date=${reminder.date}`
        : `/calendar?task=${encodeURIComponent(reminder.id)}`,
    )

  const describe = (reminder: Reminder) =>
    reminder.kind === "event"
      ? language.t("secondBrain.reminders.event", { time: reminder.time ?? "" })
      : language.t("secondBrain.reminders.task")

  const check = () => {
    const current = snapshot
    if (!current || current.directory !== layout.home.workspace()) return
    const now = new Date()
    const fired = readFired()
    const due = dueReminders({
      snapshot: current.value,
      now,
      settings: reminderSettings(settings.calendar.reminders()),
      fired: new Set(fired),
    })
    if (due.length === 0) return
    writeFired(pruneFired([...fired, ...due.map((item) => item.key)], now))
    const inView = document.visibilityState === "visible" && document.hasFocus()
    for (const reminder of due) {
      if (inView) {
        showToast({
          title: reminder.title,
          description: describe(reminder),
          actions: [{ label: language.t("secondBrain.reminders.open"), onClick: () => open(reminder) }],
        })
        continue
      }
      void platform.notify(reminder.title, describe(reminder), () => open(reminder)).catch(() => undefined)
    }
  }

  createEffect(() => {
    if (!reminderSettings(settings.calendar.reminders()).enabled || !layout.home.workspace()) return
    void refresh().then(check)
    const checker = setInterval(check, CHECK_MS)
    const refresher = setInterval(() => void refresh(), REFRESH_MS)
    onCleanup(() => {
      clearInterval(checker)
      clearInterval(refresher)
    })
  })

  makeEventListener(window, CALENDAR_CHANGED, () => void refresh().then(check))
  makeEventListener(window, "focus", () => void refresh().then(check))

  return null
}
