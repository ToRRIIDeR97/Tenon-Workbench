import { createHash } from "node:crypto"
import type {
  GoogleAccount,
  GoogleCalendarConnection,
  GoogleCalendarProviderEvent,
  GoogleTaskProviderTask,
} from "@tenon/app"

export type GoogleEventResponse = {
  id?: string
  summary?: string
  description?: string
  status?: string
  etag?: string
  recurringEventId?: string
  attendees?: unknown[]
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
}

export type GoogleTaskResponse = {
  id?: string
  title?: string
  notes?: string
  due?: string
  completed?: string
  status?: string
  deleted?: boolean
  updated?: string
  etag?: string
}

export function googleScopes(access: "read" | "write") {
  const scopes = [
    "https://www.googleapis.com/auth/calendar.readonly",
    access === "write" ? "https://www.googleapis.com/auth/tasks" : "https://www.googleapis.com/auth/tasks.readonly",
  ]
  if (access === "write") scopes.splice(1, 0, "https://www.googleapis.com/auth/calendar.events")
  return scopes
}

export type GoogleClient = { clientId: string; clientSecret: string }

export function validateGoogleClient(clientId: string, clientSecret: string): GoogleClient {
  const id = clientId.trim()
  const secret = clientSecret.trim()
  if (!id.endsWith(".apps.googleusercontent.com") || id.length > 512) throw new Error("google_client_id_invalid")
  if (!secret || secret.length > 512 || /\s/.test(secret)) throw new Error("google_client_secret_invalid")
  return { clientId: id, clientSecret: secret }
}

export function builtInGoogleClient(env: { clientId?: string; clientSecret?: string }) {
  try {
    return validateGoogleClient(env.clientId ?? "", env.clientSecret ?? "")
  } catch {
    return undefined
  }
}

export function resolveGoogleClient(
  input: { clientId?: string; clientSecret?: string },
  builtIn: GoogleClient | undefined,
): GoogleClient {
  const typed = Boolean(input.clientId?.trim() || input.clientSecret?.trim())
  if (typed) return validateGoogleClient(input.clientId ?? "", input.clientSecret ?? "")
  if (builtIn) return builtIn
  throw new Error("google_client_missing")
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url")
}

export function googleEventId(idempotencyKey: string) {
  return createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)
}

export function normalizeGoogleEvent(
  input: GoogleEventResponse,
  accountId: string,
  timeZone?: string,
): GoogleCalendarProviderEvent | undefined {
  if (!input.id || input.status === "cancelled" || !input.start || !input.end) return
  const allDay = typeof input.start.date === "string"
  const start = input.start.dateTime
  const end = input.end.dateTime
  const date = allDay ? input.start.date : start?.slice(0, 10)
  if (!date) return
  const endDate = allDay && input.end.date ? previousDate(input.end.date) : end?.slice(0, 10)
  return {
    accountId,
    providerId: input.id,
    calendarId: "primary",
    title: input.summary?.trim() || "Untitled event",
    date,
    ...(endDate && endDate !== date ? { endDate } : {}),
    ...(start ? { start: start.slice(11, 16) } : {}),
    ...(end ? { end: end.slice(11, 16) } : {}),
    ...(input.description ? { details: input.description } : {}),
    ...eventTimeZone(input, allDay, timeZone),
    allDay,
    ...(input.recurringEventId ? { recurringSeriesId: input.recurringEventId } : {}),
    participantCount: input.attendees?.length ?? 0,
    ...(input.etag ? { etag: input.etag } : {}),
  }
}

function eventTimeZone(input: GoogleEventResponse, allDay: boolean, requested: string | undefined) {
  const timezone = allDay
    ? (input.start?.timeZone ?? input.end?.timeZone)
    : (requested ?? input.start?.timeZone ?? input.end?.timeZone)
  return timezone ? { timezone } : {}
}

export function googleEventPayload(event: GoogleCalendarProviderEvent) {
  if (event.recurringSeriesId || event.participantCount > 0) throw new Error("google_write_requires_approval")
  if (event.allDay) {
    return {
      summary: event.title,
      description: event.details,
      start: { date: event.date },
      end: { date: nextDate(event.endDate ?? event.date) },
    }
  }
  if (!event.start || !event.end || !event.timezone) throw new Error("google_time_required")
  return {
    summary: event.title,
    description: event.details,
    start: { dateTime: `${event.date}T${event.start}:00`, timeZone: event.timezone },
    end: { dateTime: `${event.endDate ?? event.date}T${event.end}:00`, timeZone: event.timezone },
  }
}

export function normalizeGoogleTask(
  input: GoogleTaskResponse,
  taskList: { id: string; title: string },
  accountId: string,
): GoogleTaskProviderTask | undefined {
  if (!input.id || input.deleted || !input.updated) return
  return {
    accountId,
    providerId: input.id,
    taskListId: taskList.id,
    taskListTitle: taskList.title.trim() || "Google Tasks",
    title: input.title?.trim() || "Untitled task",
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.due ? { dueDate: input.due.slice(0, 10) } : {}),
    ...(input.status === "completed" && input.completed ? { completedAt: input.completed } : {}),
    updatedAt: input.updated,
    ...(input.etag ? { etag: input.etag } : {}),
  }
}

export function googleTaskPayload(task: GoogleTaskProviderTask) {
  if (!task.title.trim() || task.title.length > 300 || (task.notes?.length ?? 0) > 8_192) {
    throw new Error("google_task_invalid")
  }
  return {
    title: task.title.trim(),
    notes: task.notes?.trim() || null,
    due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null,
    status: task.completedAt ? "completed" : "needsAction",
    completed: task.completedAt ?? null,
  }
}

function nextDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new Error("google_date_invalid")
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function previousDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new Error("google_date_invalid")
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

export type GoogleTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
}

export function grantedCalendarAccess(scope: string | undefined): "read" | "write" | undefined {
  const granted = new Set((scope ?? "").split(/\s+/).filter(Boolean))
  const has = (item: string) => granted.has(`https://www.googleapis.com/auth/${item}`)
  if (!has("calendar.readonly")) return undefined
  if (has("calendar.events") && has("tasks")) return "write"
  return has("tasks") || has("tasks.readonly") ? "read" : undefined
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>
type OutboxState = "pending" | "offline" | "failed" | "conflict" | "succeeded"

export const GOOGLE_OUTBOX_LIMIT = 100
export const GOOGLE_OUTBOX_MAX_ATTEMPTS = 5

export async function requestGoogleToken(fetch: Fetch, endpoint: string, input: Record<string, string>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(input),
    signal: AbortSignal.timeout(30_000),
  })
  const value = (await response.json().catch(() => ({}))) as GoogleTokenResponse
  if (value.error === "invalid_grant" && input.grant_type === "refresh_token") {
    throw new Error("google_reconnect_required")
  }
  if (!response.ok || value.error) throw new Error("google_token_exchange_failed")
  return value
}

export function createGoogleAccessTokens(input: {
  fetch: Fetch
  endpoint: string
  onRotate: (accountId: string, refreshToken: string) => void | Promise<void>
  now?: () => number
}) {
  const now = input.now ?? Date.now
  const cached = new Map<string, { clientId: string; token: string; expiresAt: number }>()
  const fresh = (config: Credentials) => {
    const entry = cached.get(config.accountId)
    return Boolean(entry && entry.clientId === config.clientId && entry.expiresAt > now())
  }
  const get = async (config: Credentials) => {
    const entry = cached.get(config.accountId)
    if (entry && fresh(config)) return entry.token
    cached.delete(config.accountId)
    const tokens = await requestGoogleToken(input.fetch, input.endpoint, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    })
    if (!tokens.access_token) throw new Error("google_reconnect_required")
    if (tokens.refresh_token) await input.onRotate(config.accountId, tokens.refresh_token)
    const lifetime = (tokens.expires_in ?? 0) * 1_000 - 60_000
    if (lifetime > 0) {
      cached.set(config.accountId, {
        clientId: config.clientId,
        token: tokens.access_token,
        expiresAt: now() + lifetime,
      })
    }
    return tokens.access_token
  }
  return {
    get,
    async with<T>(config: Credentials, request: (accessToken: string) => Promise<T>) {
      const reused = fresh(config)
      return request(await get(config)).catch(async (error) => {
        if (!reused || !(error instanceof Error) || error.message !== "google_reconnect_required") throw error
        cached.delete(config.accountId)
        return request(await get(config))
      })
    },
    clear(accountId?: string) {
      if (accountId) return void cached.delete(accountId)
      cached.clear()
    },
  }
}

type Credentials = { accountId: string; clientId: string; clientSecret: string; refreshToken: string }

export const GOOGLE_LEGACY_KEYS = ["clientId", "clientSecret", "refreshToken", "access", "accountLabel", "lastSyncedAt"]

export function migrateLegacyGoogleStore<O extends { accountId?: string }, T extends { accountId?: string }>(input: {
  read: (key: string) => unknown
  id: string
  outbox: O[]
  taskOutbox: T[]
}) {
  const text = (key: string) => {
    const value = input.read(key)
    return typeof value === "string" && value ? value : undefined
  }
  const clientId = text("clientId")
  const clientSecret = text("clientSecret")
  const refreshToken = text("refreshToken")
  if (!clientId || !clientSecret || !refreshToken) return
  const tag = <E extends { accountId?: string }>(entry: E) =>
    entry.accountId ? entry : { ...entry, accountId: input.id }
  const label = text("accountLabel")
  const lastSyncedAt = text("lastSyncedAt")
  return {
    account: {
      id: input.id,
      ...(label?.includes("@") ? { email: label } : {}),
      label: label ?? "Google",
      clientId,
      clientSecret,
      refreshToken,
      access: input.read("access") === "write" ? ("write" as const) : ("read" as const),
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
    },
    outbox: input.outbox.map(tag),
    taskOutbox: input.taskOutbox.map(tag),
  }
}

export function googleConnection(input: {
  configured: boolean
  builtInClient: boolean
  accounts: GoogleAccount[]
}): GoogleCalendarConnection {
  const first = input.accounts[0]
  const lastSyncedAt = input.accounts
    .flatMap((account) => (account.lastSyncedAt ? [account.lastSyncedAt] : []))
    .sort()
    .at(-1)
  return {
    available: true,
    configured: input.configured,
    builtInClient: input.builtInClient,
    connected: input.accounts.length > 0,
    access: input.accounts.some((account) => account.access === "write") ? "write" : "read",
    pendingWrites: input.accounts.reduce((sum, account) => sum + account.pendingWrites, 0),
    failedWrites: input.accounts.reduce((sum, account) => sum + account.failedWrites, 0),
    accounts: input.accounts,
    ...(first ? { accountLabel: first.label } : {}),
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
  }
}

export function pruneOutbox<T extends { state: OutboxState }>(entries: T[], limit = GOOGLE_OUTBOX_LIMIT) {
  const excess = entries.length - limit
  if (excess <= 0) return entries
  const drop = new Set(
    [
      ...entries.filter((entry) => entry.state === "succeeded"),
      ...entries.filter((entry) => entry.state === "failed" || entry.state === "conflict"),
    ].slice(0, excess),
  )
  return entries.filter((entry) => !drop.has(entry))
}

type OutboxWriteKind = "create" | "update" | "delete"

export function mergeQueuedWrite<T extends { providerId: string; etag?: string }>(
  queued: { kind: OutboxWriteKind; item: T; reached: boolean },
  next: { kind: OutboxWriteKind; item: T; overwrite?: boolean },
) {
  const { etag: _etag, ...fields } = next.item
  const item = {
    ...fields,
    providerId: queued.item.providerId,
    ...(queued.item.etag && !next.overwrite ? { etag: queued.item.etag } : {}),
  } as T
  if (next.kind !== "delete") {
    const restored = queued.reached ? ("create" as const) : ("update" as const)
    return { kind: queued.kind === "delete" ? restored : queued.kind, item }
  }
  if (queued.kind === "create" && !queued.reached) return undefined
  return { kind: "delete" as const, item }
}

export function finishedWriteTarget<T extends { accountId: string; providerId: string; taskListId?: string }>(
  result: T | null | undefined,
  next: T,
) {
  if (!result || result.accountId !== next.accountId || result.taskListId !== next.taskListId) return undefined
  return next.providerId === result.providerId || next.providerId.startsWith("pending:") ? result : undefined
}

export function settledWrites(
  operations: ReadonlyArray<{
    state: OutboxState
    input: { idempotencyKey: string }
    result?: { providerId: string } | null
  }>,
) {
  return operations.flatMap((operation) =>
    operation.state === "succeeded"
      ? [
          {
            idempotencyKey: operation.input.idempotencyKey,
            ...(operation.result ? { providerId: operation.result.providerId } : {}),
          },
        ]
      : [],
  )
}

type GoogleErrorBody = {
  error?: {
    status?: string
    errors?: { reason?: string }[]
    details?: { reason?: string }[]
  }
}

export function classifyGoogleError(status: number, url: string, body: string) {
  const api = new URL(url).hostname === "tasks.googleapis.com" ? "tasks" : "calendar"
  const parsed = (() => {
    try {
      return JSON.parse(body) as GoogleErrorBody
    } catch {
      return undefined
    }
  })()
  const reasons = [
    ...(parsed?.error?.details ?? []).map((item) => item.reason),
    ...(parsed?.error?.errors ?? []).map((item) => item.reason),
    parsed?.error?.status,
  ].filter((item): item is string => typeof item === "string" && /^[A-Za-z_]{1,64}$/.test(item))
  const reason = reasons[0]
  const has = (...names: string[]) => reasons.some((item) => names.includes(item))
  const code = (() => {
    if (has("SERVICE_DISABLED", "accessNotConfigured")) return `google_api_disabled_${api}`
    if (has("ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientPermissions")) return "google_scope_missing"
    if (status === 429 || has("RATE_LIMIT_EXCEEDED", "rateLimitExceeded", "userRateLimitExceeded")) {
      return "google_rate_limited"
    }
    return `google_http_${status}`
  })()
  return { code, api, reason }
}

export function outboxFailureState(message: string, attempts: number): "conflict" | "failed" | "offline" {
  if (message === "google_conflict") return "conflict"
  if (message.startsWith("google_api_disabled_") || message === "google_scope_missing") return "failed"
  const status = Number(message.match(/^google_http_(\d{3})$/)?.[1])
  if (status && !transientStatus(status)) return "failed"
  if (message === "google_reconnect_required") return "offline"
  return attempts >= GOOGLE_OUTBOX_MAX_ATTEMPTS ? "failed" : "offline"
}

function transientStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export const GOOGLE_EVENT_LIMIT = 5_000
const titleLimit = 300
const detailsLimit = 20_000

export function sanitizeProviderEvent(event: GoogleCalendarProviderEvent): GoogleCalendarProviderEvent {
  const title = truncate(event.title.trim(), titleLimit) || "Untitled event"
  const details = event.details?.trim() ? truncate(event.details.trim(), detailsLimit) : undefined
  const { details: _details, ...rest } = event
  const sameDay = !event.endDate || event.endDate === event.date
  const times = event.start && event.end && sameDay && event.end <= event.start ? minuteAfter(event.start) : undefined
  return { ...rest, title, ...(details ? { details } : {}), ...times }
}

export function sanitizeProviderTask(task: GoogleTaskProviderTask): GoogleTaskProviderTask {
  const notes = task.notes?.trim() ? truncate(task.notes.trim(), detailsLimit) : undefined
  const { notes: _notes, ...rest } = task
  return {
    ...rest,
    title: truncate(task.title.trim(), titleLimit) || "Untitled task",
    taskListTitle: truncate(task.taskListTitle.trim(), titleLimit) || "Google Tasks",
    ...(notes ? { notes } : {}),
  }
}

export function nearestEvents<T extends { date: string }>(
  events: ReadonlyArray<T>,
  today: string,
  limit = GOOGLE_EVENT_LIMIT,
) {
  if (events.length <= limit) return [...events]
  const origin = Date.parse(`${today}T00:00:00Z`)
  const distance = (event: T) => Math.abs(Date.parse(`${event.date}T00:00:00Z`) - origin)
  const kept = new Set(events.toSorted((left, right) => distance(left) - distance(right)).slice(0, limit))
  return events.filter((event) => kept.has(event))
}

function minuteAfter(start: string) {
  const [hours, minutes] = start.split(":").map(Number)
  const total = Math.min(hours * 60 + minutes + 1, 23 * 60 + 59)
  const begin = total === hours * 60 + minutes ? total - 1 : hours * 60 + minutes
  return { start: clock(begin), end: clock(total) }
}

function clock(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function truncate(value: string, limit: number) {
  const characters = [...value]
  return characters.length > limit ? characters.slice(0, limit).join("").trim() : value
}
