import { createSignal } from "solid-js"
import type { GoogleCalendarConnection, GoogleCalendarPlatform, GoogleTaskProviderTask } from "@/context/platform"
import { mergeProviderEvents } from "./calendar-domain"
import { readCalendar, writeCalendar, type CalendarSnapshot, type PlannerTask } from "./client"

type Client = Parameters<typeof readCalendar>[0]

const [busy, setBusy] = createSignal(false)
const [version, setVersion] = createSignal(0)
const [lastSynced, setLastSynced] = createSignal<number>()
export const calendarSync = { busy, version, lastSynced }

export const providerTask = (task: GoogleTaskProviderTask, local?: PlannerTask): PlannerTask => ({
  id: `google-task:${task.accountId}:${task.taskListId}:${task.providerId}`,
  title: task.title,
  ...(task.notes ? { notes: task.notes } : {}),
  ...(local?.projectId ? { projectId: local.projectId } : {}),
  ...(task.dueDate ? { dueDate: task.dueDate } : {}),
  ...(local?.scheduledDate ? { scheduledDate: local.scheduledDate } : {}),
  ...(local?.start ? { start: local.start, end: local.end } : {}),
  ...(task.completedAt ? { completedAt: task.completedAt } : {}),
  accountId: task.accountId,
  providerId: task.providerId,
  taskListId: task.taskListId,
  taskListTitle: task.taskListTitle,
  ...(task.etag ? { etag: task.etag } : {}),
  createdAt: local?.createdAt ?? task.updatedAt,
  updatedAt: task.updatedAt,
  source: "google",
  syncState: "synced",
})

export const isQueuedAgentTask = (task: PlannerTask) =>
  task.source === "google" &&
  task.outboxKind === "create" &&
  Boolean(task.outboxKey?.startsWith("agent:")) &&
  Boolean(task.providerId?.startsWith("pending:")) &&
  Boolean(task.accountId)

export async function dispatchQueuedTasks(google: GoogleCalendarPlatform, current: CalendarSnapshot) {
  const queued = current.tasks.filter(isQueuedAgentTask)
  const sent = new Map<string, PlannerTask>()
  const created: GoogleTaskProviderTask[] = []
  for (const task of queued) {
    const result = await google
      .writeTask({
        kind: "create",
        idempotencyKey: task.outboxKey!,
        task: {
          accountId: task.accountId!,
          providerId: task.providerId!,
          taskListId: task.taskListId ?? "@default",
          taskListTitle: task.taskListTitle ?? "Tasks",
          title: task.title,
          ...(task.notes ? { notes: task.notes } : {}),
          ...(task.dueDate ? { dueDate: task.dueDate } : {}),
          ...(task.completedAt ? { completedAt: task.completedAt } : {}),
          updatedAt: task.updatedAt,
        },
      })
      .catch(() => undefined)
    if (!result?.task) continue
    if (result.state === "synced") created.push(result.task)
    sent.set(task.id, {
      ...providerTask(result.task, task),
      syncState: result.state === "synced" ? "synced" : result.state,
      ...(result.state === "synced" ? {} : { outboxKind: "create" as const, outboxKey: task.outboxKey }),
    })
  }
  if (sent.size === 0) return { current, created }
  return { current: { ...current, tasks: current.tasks.map((task) => sent.get(task.id) ?? task) }, created }
}

export async function syncGoogleCalendar(input: {
  google: GoogleCalendarPlatform
  client: Client
  current?: CalendarSnapshot
}): Promise<{ saved: CalendarSnapshot; connection: GoogleCalendarConnection } | undefined> {
  if (busy()) return
  setBusy(true)
  try {
    const pulled = await input.google.sync()
    const dispatched = await dispatchQueuedTasks(input.google, input.current ?? (await readCalendar(input.client)))
    const current = dispatched.current
    const pulledKeys = new Set(pulled.tasks.map((task) => `${task.accountId}:${task.taskListId}:${task.providerId}`))
    const result = {
      ...pulled,
      tasks: [
        ...pulled.tasks,
        ...dispatched.created.filter(
          (task) => !pulledKeys.has(`${task.accountId}:${task.taskListId}:${task.providerId}`),
        ),
      ],
    }
    const accountOf = (accountId: string | undefined) => accountId ?? result.connection.accounts[0]?.id
    const synced = new Set(result.syncedAccounts)
    const connected = new Set(result.connection.accounts.map((account) => account.id))
    const failed = (account: string | undefined) => Boolean(account && connected.has(account) && !synced.has(account))
    const kept = (accountId: string | undefined) => failed(accountOf(accountId))
    const settled = new Map(result.settled.map((write) => [write.idempotencyKey, write.providerId]))
    const events = mergeProviderEvents(current.events, result.events, {
      accountOf,
      failed,
      synced: (account) => Boolean(account && synced.has(account)),
      settled: (outboxKey) => settled.has(outboxKey),
    })
    const taskKey = (task: { accountId?: string; taskListId?: string; providerId?: string }) =>
      `${accountOf(task.accountId)}:${task.taskListId}:${task.providerId}`
    const localByProvider = new Map(
      current.tasks
        .filter((task) => task.source === "google" && task.providerId && task.taskListId)
        .map((task) => {
          const providerId = settled.get(task.outboxKey ?? "") ?? task.providerId
          return [taskKey({ ...task, providerId }), task] as const
        }),
    )
    const remoteKeys = new Set(result.tasks.map(taskKey))
    const tasks = [
      ...current.tasks.filter((task) => task.source === "local" || kept(task.accountId)),
      ...current.tasks.filter(
        (task) =>
          task.source === "google" &&
          synced.has(accountOf(task.accountId) ?? "") &&
          Boolean(task.outboxKey) &&
          !settled.has(task.outboxKey!) &&
          !remoteKeys.has(taskKey(task)),
      ),
      ...result.tasks.map((task) => providerTask(task, localByProvider.get(taskKey(task)))),
    ]
    const saved = await writeCalendar(input.client, events, current.revision, tasks)
    setLastSynced(Date.now())
    setVersion((value) => value + 1)
    return { saved, connection: result.connection }
  } finally {
    setBusy(false)
  }
}
