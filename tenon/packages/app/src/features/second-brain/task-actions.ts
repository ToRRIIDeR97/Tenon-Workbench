import { useLanguage } from "@/context/language"
import { usePlatform, type GoogleCalendarConnection } from "@/context/platform"
import { showToast } from "@/utils/toast"
import { providerTask } from "./calendar-sync"
import { SecondBrainRequestError, writeCalendar, type CalendarSnapshot, type PlannerTask } from "./client"

/** Items saved before multiple accounts carry no account. They came from the one account then connected, which the
 * desktop migration keeps first in the list. */
export const itemAccount = (accountId: string | undefined, connection: GoogleCalendarConnection | undefined) =>
  accountId ?? connection?.accounts[0]?.id

export const writeAccounts = (connection: GoogleCalendarConnection | undefined) =>
  (connection?.accounts ?? []).filter((account) => account.access === "write")

/** A Google or vault failure in the user's words. */
export function googleErrorMessage(error: unknown, t: ReturnType<typeof useLanguage>["t"]) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("secure_storage")) return t("secondBrain.calendar.google.error.secureStorage")
  if (message.includes("write_consent")) return t("secondBrain.calendar.google.error.writeConsent")
  if (message.includes("conflict")) return t("secondBrain.calendar.google.error.conflict")
  if (message.includes("oauth_denied")) return t("secondBrain.calendar.google.error.denied")
  if (message.includes("api_disabled_tasks")) return t("secondBrain.calendar.google.error.tasksDisabled")
  if (message.includes("api_disabled_calendar")) return t("secondBrain.calendar.google.error.calendarDisabled")
  if (message.includes("scope_missing")) return t("secondBrain.calendar.google.error.scopeMissing")
  if (message.includes("rate_limited")) return t("secondBrain.calendar.google.error.rateLimited")
  if (message.includes("reconnect_required")) return t("secondBrain.calendar.google.error.reconnect")
  if (
    message.includes("client_missing") ||
    message.includes("client_id_invalid") ||
    message.includes("client_secret_invalid")
  )
    return t("secondBrain.calendar.google.error.credentials")
  if (error instanceof SecondBrainRequestError && error.reason)
    return t("secondBrain.calendar.google.error.rejected", { reason: error.reason })
  return t("secondBrain.calendar.google.error.request")
}

function googleTaskFields(task: PlannerTask) {
  return JSON.stringify({
    title: task.title,
    notes: task.notes ?? "",
    dueDate: task.dueDate ?? "",
    completedAt: task.completedAt ?? "",
  })
}

/** Task writes shared by Calendar and Home, so ticking a task takes the same Google outbox and Undo on both. */
export function createTaskActions(input: {
  directory: () => string
  client: (directory: string) => Parameters<typeof writeCalendar>[0]
  snapshot: () => CalendarSnapshot | undefined
  mutate: (next: CalendarSnapshot) => void
  connection: () => GoogleCalendarConnection | undefined
  refreshConnection: () => unknown
}) {
  const language = useLanguage()
  const platform = usePlatform()

  const persist = async (tasks: ReadonlyArray<PlannerTask>) => {
    // Captured before the Google round trip: the user can switch workspace while it runs, and the
    // result belongs to the calendar these tasks came from.
    const workspace = input.directory()
    const base = input.snapshot()
    if (!workspace) return
    const current = base?.tasks ?? []
    const removed = current.find((task) => task.source === "google" && !tasks.some((next) => next.id === task.id))
    const changed = tasks.find((task) => {
      if (task.source !== "google") return false
      const previous = current.find((item) => item.id === task.id)
      return !previous || googleTaskFields(previous) !== googleTaskFields(task)
    })
    if (removed && changed) throw new Error("google_multiple_task_writes")

    let next = [...tasks]
    const connection = input.connection()
    const connected = connection?.connected && connection.access === "write"
    // Without a Google connection a removed Google task is only dropped from the planner.
    const target = removed && !connected ? changed : (removed ?? changed)
    if (target) {
      const google = platform.googleCalendar
      const accountId = itemAccount(target.accountId, connection)
      if (!google || !accountId || !writeAccounts(connection).some((account) => account.id === accountId)) {
        throw new Error("google_write_consent_required")
      }
      const kind = removed ? "delete" : target.providerId?.startsWith("pending:") ? "create" : "update"
      const idempotencyKey = target.outboxKey || crypto.randomUUID()
      const result = await google.writeTask({
        kind,
        idempotencyKey,
        task: {
          accountId,
          providerId: target.providerId ?? `pending:${target.id}`,
          taskListId: target.taskListId ?? "@default",
          taskListTitle: target.taskListTitle ?? language.t("secondBrain.tasks.google.defaultList"),
          title: target.title,
          ...(target.notes ? { notes: target.notes } : {}),
          ...(target.dueDate ? { dueDate: target.dueDate } : {}),
          ...(target.completedAt ? { completedAt: target.completedAt } : {}),
          updatedAt: target.updatedAt,
          ...(target.etag ? { etag: target.etag } : {}),
        },
      })
      if (kind === "delete") {
        if (result.state !== "synced") {
          next.push({ ...target, syncState: result.state, outboxKind: kind, outboxKey: idempotencyKey })
        }
      } else {
        if (!result.task) throw new Error("google_task_write_failed")
        const savedTask: PlannerTask = {
          ...providerTask(result.task, target),
          syncState: result.state === "synced" ? ("synced" as const) : result.state,
          ...(result.state === "synced" ? {} : { outboxKind: kind, outboxKey: idempotencyKey }),
        }
        next = next.map((task) => (task.id === target.id ? savedTask : task))
      }
      await input.refreshConnection()
    }
    const saved = await writeCalendar(input.client(workspace), base?.events ?? [], base?.revision, next)
    if (input.directory() === workspace) input.mutate(saved)
  }

  const toggle = async (task: PlannerTask) => {
    const now = new Date().toISOString()
    const completedAt = task.completedAt ? undefined : now
    try {
      await persist(
        (input.snapshot()?.tasks ?? []).map((item) =>
          item.id === task.id ? { ...item, completedAt, updatedAt: now } : item,
        ),
      )
    } catch (error) {
      showToast({ variant: "error", description: googleErrorMessage(error, language.t) })
      return
    }
    if (!completedAt) return
    showToast({
      description: language.t("secondBrain.tasks.completed", { title: task.title }),
      actions: [
        {
          label: language.t("secondBrain.sidebar.undo"),
          onClick: () => {
            const current = input.snapshot()?.tasks.find((item) => item.id === task.id)
            if (current?.completedAt) void toggle(current)
          },
        },
      ],
    })
  }

  return { persist, toggle }
}
