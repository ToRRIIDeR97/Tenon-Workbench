import { randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import type {
  GoogleCalendarConnection,
  GoogleCalendarPlatform,
  GoogleCalendarProviderEvent,
  GoogleCalendarWrite,
  GoogleTaskProviderTask,
  GoogleTaskWrite,
} from "@tenon/app"
import { net, safeStorage, shell } from "electron"
import { write as writeLog } from "./logging"
import { decryptSecret, encryptSecret } from "./secret-storage"
import { getStore } from "./store"
import {
  builtInGoogleClient,
  classifyGoogleError,
  createGoogleAccessTokens,
  finishedWriteTarget,
  googleEventId,
  googleEventPayload,
  googleScopes,
  googleConnection,
  googleTaskPayload,
  GOOGLE_LEGACY_KEYS,
  mergeQueuedWrite,
  migrateLegacyGoogleStore,
  nearestEvents,
  normalizeGoogleEvent,
  normalizeGoogleTask,
  outboxFailureState,
  pkceChallenge,
  pruneOutbox,
  requestGoogleToken,
  resolveGoogleClient,
  sanitizeProviderEvent,
  sanitizeProviderTask,
  settledWrites,
  type GoogleEventResponse,
  type GoogleTaskResponse,
} from "./google-calendar-domain"

const storeName = "second-brain.google"
const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"
const tokenEndpoint = "https://oauth2.googleapis.com/token"
const revokeEndpoint = "https://oauth2.googleapis.com/revoke"
const calendarEndpoint = "https://www.googleapis.com/calendar/v3/calendars/primary"
const eventsEndpoint = `${calendarEndpoint}/events`
const taskListsEndpoint = "https://tasks.googleapis.com/tasks/v1/users/@me/lists"
const tasksEndpoint = "https://tasks.googleapis.com/tasks/v1/lists"
const oauthTimeoutMs = 5 * 60 * 1_000
const taskLimit = 5_000
// Set at build time from desktop/.env.local; Google treats a desktop client secret as non-confidential.
const builtInClient = builtInGoogleClient({
  clientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
  clientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
})

type Account = {
  id: string
  email?: string
  label: string
  clientId: string
  clientSecret: string
  refreshToken: string
  access: "read" | "write"
  lastSyncedAt?: string
}

/** An account as kept in the store: the client secret and refresh token are encrypted. */
type StoredAccount = Account

type StoredOutbox = {
  id: string
  accountId: string
  input: GoogleCalendarWrite
  state: "pending" | "offline" | "failed" | "conflict" | "succeeded"
  attempts: number
  createdAt: string
  lastError?: string
  result?: GoogleCalendarProviderEvent | null
  /** This began as a create that was attempted before an edit, so Google may have it. */
  reached?: boolean
}

type StoredTaskOutbox = {
  id: string
  accountId: string
  input: GoogleTaskWrite
  state: "pending" | "offline" | "failed" | "conflict" | "succeeded"
  attempts: number
  createdAt: string
  lastError?: string
  result?: GoogleTaskProviderTask | null
}

type TaskListResponse = { id?: string; title?: string }

const netFetch = (input: string, init: RequestInit) => net.fetch(input, init)
// A rotated refresh token is stored on its own, so no stale copy of the account can overwrite it.
const accessTokens = createGoogleAccessTokens({
  fetch: netFetch,
  endpoint: tokenEndpoint,
  onRotate: async (accountId, refreshToken) => updateAccount(accountId, { refreshToken: await encrypt(refreshToken) }),
})

export function createGoogleCalendarService(): GoogleCalendarPlatform {
  let busy = false
  // The browser consent can take minutes; it has its own guard so syncs and writes aren't blocked, and
  // starting Connect again cancels it (the user may have closed the Google tab).
  let consent: AbortController | undefined
  // The last sync failure per account; in memory only, so a restart shows a clean slate until the next sync.
  const errors = new Map<string, string>()

  const status = async (): Promise<GoogleCalendarConnection> => {
    if (!(await secureStorageAvailable())) {
      return {
        available: false,
        configured: false,
        builtInClient: false,
        connected: false,
        access: "read",
        pendingWrites: 0,
        failedWrites: 0,
        accounts: [],
      }
    }
    const accounts = await readAccounts()
    const outbox = [...readOutbox(), ...readTaskOutbox()]
    const count = (accountId: string, states: StoredOutbox["state"][]) =>
      outbox.filter((operation) => operation.accountId === accountId && states.includes(operation.state)).length
    return googleConnection({
      configured: accounts.length > 0,
      builtInClient: Boolean(builtInClient),
      accounts: accounts.map((account) => ({
        id: account.id,
        ...(account.email ? { email: account.email } : {}),
        label: account.label,
        access: account.access,
        ...(account.lastSyncedAt ? { lastSyncedAt: account.lastSyncedAt } : {}),
        ...(errors.has(account.id) ? { errorCode: errors.get(account.id) } : {}),
        pendingWrites: count(account.id, ["pending", "offline"]),
        failedWrites: count(account.id, ["failed", "conflict"]),
      })),
    })
  }

  const connect: GoogleCalendarPlatform["connect"] = async (input) => {
    if (busy) throw new Error("google_operation_busy")
    if (!(await secureStorageAvailable())) throw new Error("google_secure_storage_unavailable")
    const windowId = input.windowId
    if (!Number.isSafeInteger(windowId) || windowId! <= 0) throw new Error("google_window_invalid")
    const client = resolveGoogleClient(input, builtInClient)
    consent?.abort()
    const controller = new AbortController()
    consent = controller
    const tokens = await authorize({ ...client, access: input.access, windowId: windowId!, signal: controller.signal })
    if (consent === controller) consent = undefined
    if (busy) throw new Error("google_operation_busy")
    busy = true
    try {
      if (!tokens.access_token || !tokens.refresh_token) throw new Error("google_refresh_token_missing")
      const calendar = await providerJson<{ summary?: string; id?: string }>(calendarEndpoint, tokens.access_token)
      // The primary calendar's ID is the account's address, so signing in again renews that account.
      const email = calendar.id?.includes("@") ? calendar.id : undefined
      const existing = email ? (await readAccounts()).find((account) => account.email === email) : undefined
      const id = existing?.id ?? randomUUID()
      accessTokens.clear(id)
      errors.delete(id)
      await saveAccount({
        ...client,
        id,
        ...(email ? { email } : {}),
        label: calendar.summary ?? calendar.id ?? "Google",
        refreshToken: tokens.refresh_token,
        access: input.access,
        ...(existing?.lastSyncedAt ? { lastSyncedAt: existing.lastSyncedAt } : {}),
      })
      return status()
    } finally {
      busy = false
    }
  }

  const sync: GoogleCalendarPlatform["sync"] = async () => {
    if (busy) throw new Error("google_operation_busy")
    const accounts = await requireAccounts()
    // Decrypting awaits the OS key store, so check again before claiming the guard.
    if (busy) throw new Error("google_operation_busy")
    busy = true
    try {
      const events: GoogleCalendarProviderEvent[] = []
      const tasks: GoogleTaskProviderTask[] = []
      const syncedAccounts: string[] = []
      // One at a time, so a slow or revoked account never hides another account's results.
      for (const account of accounts) {
        const result = await syncAccount(account).catch((error: unknown) => {
          errors.set(account.id, error instanceof Error ? error.message : "google_sync_failed")
          return undefined
        })
        if (!result) continue
        errors.delete(account.id)
        events.push(...result.events)
        tasks.push(...result.tasks)
        syncedAccounts.push(account.id)
        // Only the timestamp: `account` may hold a refresh token that was rotated during this sync.
        updateAccount(account.id, { lastSyncedAt: new Date().toISOString() })
      }
      if (syncedAccounts.length === 0) throw new Error(errors.get(accounts[0].id) ?? "google_sync_failed")
      return {
        events,
        tasks,
        syncedAccounts,
        settled: [...settledWrites(readOutbox()), ...settledWrites(readTaskOutbox())],
        connection: await status(),
      }
    } finally {
      busy = false
    }
  }

  const write: GoogleCalendarPlatform["write"] = async (input) => {
    if (busy) throw new Error("google_operation_busy")
    const account = await requireWriteAccount(input.event.accountId)
    if (busy) throw new Error("google_operation_busy")
    const { overwrite, ...fields } = input
    const event = overwrite ? withoutEtag(input.event) : input.event
    const request: GoogleCalendarWrite = {
      ...fields,
      event: input.kind === "create" ? { ...event, providerId: googleEventId(input.idempotencyKey) } : event,
    }
    validateWrite(request)
    const outbox = readOutbox()
    const stored = outbox.find((operation) => operation.input.idempotencyKey === request.idempotencyKey)
    const edited = Boolean(stored) && JSON.stringify(stored?.input) !== JSON.stringify(request)
    let existing = stored
    if (stored?.state === "succeeded") {
      if (!edited) return { state: "synced", event: stored.result ?? null }
      const finished = finishedWriteTarget(stored.result, request.event)
      if (!finished) throw new Error("google_idempotency_collision")
      // The write finished before the page heard of it, so this edit goes on top of Google's copy.
      existing = {
        ...stored,
        input: { ...request, kind: "update", event: finished },
        reached: false,
        result: undefined,
      }
    }
    let operation: StoredOutbox =
      existing ??
      ({
        id: randomUUID(),
        accountId: account.id,
        input: request,
        state: "pending",
        attempts: 0,
        createdAt: new Date().toISOString(),
      } satisfies StoredOutbox)
    if (!existing) persistOutbox([...outbox, operation])
    if (existing && edited) {
      const reached = Boolean(existing.reached) || (existing.input.kind === "create" && existing.attempts > 0)
      const merged = mergeQueuedWrite(
        { kind: existing.input.kind, item: existing.input.event, reached },
        { kind: request.kind, item: request.event, overwrite },
      )
      if (!merged) {
        persistOutbox(outbox.filter((item) => item.id !== existing.id))
        return { state: "synced", event: null }
      }
      operation = {
        ...existing,
        input: { kind: merged.kind, idempotencyKey: request.idempotencyKey, event: merged.item },
        state: "pending",
        attempts: 0,
        lastError: undefined,
        reached,
      }
      persistOutbox(outbox.map((item) => (item.id === existing.id ? operation : item)))
    }
    busy = true
    try {
      return await dispatch(account, operation)
    } finally {
      busy = false
    }
  }

  const writeTask: GoogleCalendarPlatform["writeTask"] = async (input) => {
    if (busy) throw new Error("google_operation_busy")
    const account = await requireWriteAccount(input.task.accountId)
    if (busy) throw new Error("google_operation_busy")
    const { overwrite, ...fields } = input
    const request: GoogleTaskWrite = { ...fields, task: overwrite ? withoutEtag(input.task) : input.task }
    const outbox = readTaskOutbox()
    const stored = outbox.find((operation) => operation.input.idempotencyKey === request.idempotencyKey)
    const finished = stored?.state === "succeeded" ? finishedWriteTarget(stored.result, request.task) : undefined
    // Google has no ID for a task still queued as a create, so there is nothing to delete there. A create
    // whose response was lost shows up at the next sync as an ordinary task.
    if (request.kind === "delete" && request.task.providerId.startsWith("pending:") && stored?.state !== "succeeded") {
      if (stored) persistTaskOutbox(outbox.filter((item) => item.id !== stored.id))
      return { state: "synced", task: null }
    }
    validateTaskWrite(finished ? { ...request, task: { ...request.task, providerId: finished.providerId } } : request)
    const edited = Boolean(stored) && JSON.stringify(stored?.input) !== JSON.stringify(request)
    let existing = stored
    if (stored?.state === "succeeded") {
      if (!edited) return { state: "synced", task: stored.result ?? null }
      if (!finished) throw new Error("google_idempotency_collision")
      // The write finished before the page heard of it, so this edit goes on top of Google's copy.
      existing = { ...stored, input: { ...request, kind: "update", task: finished }, result: undefined }
    }
    let operation: StoredTaskOutbox =
      existing ??
      ({
        id: randomUUID(),
        accountId: account.id,
        input: request,
        state: "pending",
        attempts: 0,
        createdAt: new Date().toISOString(),
      } satisfies StoredTaskOutbox)
    if (!existing) persistTaskOutbox([...outbox, operation])
    if (existing && edited) {
      const merged = mergeQueuedWrite(
        { kind: existing.input.kind, item: existing.input.task, reached: false },
        { kind: request.kind, item: request.task, overwrite },
      )
      if (!merged) {
        persistTaskOutbox(outbox.filter((item) => item.id !== existing.id))
        return { state: "synced", task: null }
      }
      operation = {
        ...existing,
        input: { kind: merged.kind, idempotencyKey: request.idempotencyKey, task: merged.item },
        state: "pending",
        attempts: 0,
        lastError: undefined,
      }
      persistTaskOutbox(outbox.map((item) => (item.id === existing.id ? operation : item)))
    }
    busy = true
    try {
      return await dispatchTask(account, operation)
    } finally {
      busy = false
    }
  }

  const discardConflict: GoogleCalendarPlatform["discardConflict"] = async ({ idempotencyKey }) => {
    if (busy) throw new Error("google_operation_busy")
    const keep = (operation: StoredOutbox | StoredTaskOutbox) =>
      operation.state !== "conflict" || operation.input.idempotencyKey !== idempotencyKey
    persistOutbox(readOutbox().filter(keep))
    persistTaskOutbox(readTaskOutbox().filter(keep))
    return status()
  }

  const disconnect: GoogleCalendarPlatform["disconnect"] = async (input) => {
    if (busy) throw new Error("google_operation_busy")
    const accounts = await readAccounts()
    if (busy) throw new Error("google_operation_busy")
    const targets = input?.accountId ? accounts.filter((account) => account.id === input.accountId) : accounts
    if (input?.accountId && targets.length === 0) throw new Error("google_account_not_found")
    busy = true
    try {
      await Promise.all(
        targets.map((account) =>
          net
            .fetch(revokeEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ token: account.refreshToken }),
              signal: AbortSignal.timeout(30_000),
            })
            .catch(() => undefined),
        ),
      )
      const removed = new Set(targets.map((account) => account.id))
      removed.forEach((id) => {
        accessTokens.clear(id)
        errors.delete(id)
      })
      if (removed.size === accounts.length) {
        getStore(storeName).clear()
        return status()
      }
      const store = getStore(storeName)
      store.set(
        "accounts",
        readStoredAccounts().filter((account) => !removed.has(account.id)),
      )
      persistOutbox(readOutbox().filter((operation) => !removed.has(operation.accountId)))
      persistTaskOutbox(readTaskOutbox().filter((operation) => !removed.has(operation.accountId)))
      return status()
    } finally {
      busy = false
    }
  }

  return { status, connect, sync, write, writeTask, discardConflict, disconnect }
}

async function syncAccount(account: Account) {
  const credentials = accountCredentials(account)
  // Exchanged first, so a revoked grant stops the sync before any queued write is retried.
  await accessTokens.get(credentials)
  await retryOutbox(account)
  await retryTaskOutbox(account)
  return accessTokens.with(credentials, async (accessToken) => {
    const [events, tasks] = await Promise.all([
      fetchGoogleEvents(accessToken, account.id),
      fetchGoogleTasks(accessToken, account.id),
    ])
    return { events, tasks }
  })
}

async function fetchGoogleEvents(accessToken: string, accountId: string) {
  const events: GoogleCalendarProviderEvent[] = []
  // Times come back as wall-clock times in the device's zone, which is how the planner shows them.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  let pageToken: string | undefined
  do {
    const url = new URL(eventsEndpoint)
    url.searchParams.set("singleEvents", "true")
    url.searchParams.set("showDeleted", "false")
    url.searchParams.set("maxResults", "2500")
    url.searchParams.set("timeMin", rangeDate(-365))
    url.searchParams.set("timeMax", rangeDate(730))
    if (timeZone) url.searchParams.set("timeZone", timeZone)
    if (pageToken) url.searchParams.set("pageToken", pageToken)
    const page = await providerJson<{ items?: GoogleEventResponse[]; nextPageToken?: string }>(
      url,
      accessToken,
      undefined,
      accountId,
    )
    for (const item of page.items ?? []) {
      const event = normalizeGoogleEvent(item, accountId, timeZone)
      if (event) events.push(sanitizeProviderEvent(event))
    }
    pageToken = page.nextPageToken
  } while (pageToken)
  // The planner holds at most 5,000 events; keep the ones nearest to today.
  return nearestEvents(events, new Date().toISOString().slice(0, 10))
}

async function fetchGoogleTasks(accessToken: string, accountId: string) {
  const taskLists: { id: string; title: string }[] = []
  let listPageToken: string | undefined
  do {
    const url = new URL(taskListsEndpoint)
    url.searchParams.set("maxResults", "1000")
    if (listPageToken) url.searchParams.set("pageToken", listPageToken)
    const page = await providerJson<{ items?: TaskListResponse[]; nextPageToken?: string }>(
      url,
      accessToken,
      undefined,
      accountId,
    )
    for (const item of page.items ?? []) {
      if (item.id) taskLists.push({ id: item.id, title: item.title?.trim() || "Google Tasks" })
      if (taskLists.length >= 2_000) break
    }
    listPageToken = taskLists.length < 2_000 ? page.nextPageToken : undefined
  } while (listPageToken)

  // Three lists at a time; results are joined in list order before the cap, so the cap is stable.
  const perList: GoogleTaskProviderTask[][] = []
  const queue = taskLists.map((taskList, index) => ({ taskList, index }))
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      perList[next.index] = await fetchTaskList(accessToken, accountId, next.taskList)
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
  return perList.flat().slice(0, taskLimit)
}

async function fetchTaskList(accessToken: string, accountId: string, taskList: { id: string; title: string }) {
  const tasks: GoogleTaskProviderTask[] = []
  const completedSince = rangeDate(-365)
  let taskPageToken: string | undefined
  do {
    const url = new URL(`${tasksEndpoint}/${encodeURIComponent(taskList.id)}/tasks`)
    url.searchParams.set("maxResults", "100")
    url.searchParams.set("showCompleted", "true")
    url.searchParams.set("showHidden", "true")
    url.searchParams.set("showDeleted", "false")
    if (taskPageToken) url.searchParams.set("pageToken", taskPageToken)
    const page = await providerJson<{ items?: GoogleTaskResponse[]; nextPageToken?: string }>(
      url,
      accessToken,
      undefined,
      accountId,
    )
    for (const item of page.items ?? []) {
      const task = normalizeGoogleTask(item, taskList, accountId)
      // Tasks completed over a year ago would only crowd out current ones under the cap. Filtered
      // here rather than with `completedMin`, whose effect on open tasks the API leaves unspecified.
      if (task && (!task.completedAt || task.completedAt >= completedSince)) tasks.push(sanitizeProviderTask(task))
      if (tasks.length >= taskLimit) return tasks
    }
    taskPageToken = page.nextPageToken
  } while (taskPageToken)
  return tasks
}

async function authorize(input: {
  clientId: string
  clientSecret: string
  access: "read" | "write"
  windowId: number
  signal: AbortSignal
}) {
  const verifier = randomBytes(32).toString("base64url")
  const state = `${input.windowId}.${randomBytes(24).toString("base64url")}`
  const callback = Promise.withResolvers<string>()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/oauth2/callback") {
      response.writeHead(404).end("Not found")
      return
    }
    const returnedState = url.searchParams.get("state")
    const code = url.searchParams.get("code")
    const error = url.searchParams.get("error")
    response.setHeader("Content-Type", "text/html; charset=utf-8")
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
    // Any local process or web page can hit this port. A request without our state is refused
    // but does not end the sign-in, so it cannot cancel the user's real callback.
    if (returnedState !== state) {
      response.writeHead(400).end("<p>Google sign-in could not be completed. You can close this window.</p>")
      return
    }
    if (error || !code) {
      response.writeHead(400).end("<p>Google sign-in could not be completed. You can close this window.</p>")
      callback.reject(new Error(error ? "google_oauth_denied" : "google_oauth_code_missing"))
      return
    }
    response.writeHead(200).end("<p>Google Calendar is connected. You can close this window.</p>")
    callback.resolve(code)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("google_loopback_unavailable")
  }
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`
  const url = new URL(authorizeEndpoint)
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("access_type", "offline")
  // select_account lets the user pick a different Google account than the browser's current one.
  url.searchParams.set("prompt", "select_account consent")
  url.searchParams.set("scope", googleScopes(input.access).join(" "))
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", pkceChallenge(verifier))
  url.searchParams.set("code_challenge_method", "S256")
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancelled = () => callback.reject(new Error("google_oauth_cancelled"))
  input.signal.addEventListener("abort", cancelled, { once: true })
  try {
    await shell.openExternal(url.href)
    const code = await Promise.race([
      callback.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("google_oauth_timeout")), oauthTimeoutMs)
      }),
    ])
    return requestGoogleToken(netFetch, tokenEndpoint, {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    })
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener("abort", cancelled)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function providerJson<T>(
  input: string | URL,
  accessToken: string,
  init?: RequestInit,
  accountId?: string,
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${accessToken}`)
  if (init?.body) headers.set("Content-Type", "application/json")
  const response = await net.fetch(input.toString(), {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 401) {
    if (accountId) accessTokens.clear(accountId)
    throw new Error("google_reconnect_required")
  }
  if (response.status === 412) throw new Error("google_conflict")
  if (!response.ok) throw await providerError(response, input.toString())
  return (await response.json()) as T
}

// Logs only the API, status and Google's reason code; the body can echo event or task content.
async function providerError(response: Response, url: string) {
  const body = await response.text().catch(() => "")
  const { code, api, reason } = classifyGoogleError(response.status, url, body.slice(0, 64_000))
  writeLog("google", "google request failed", { api, status: response.status, reason, code }, "warn")
  return new Error(code)
}

async function dispatch(account: Account, operation: StoredOutbox) {
  updateOperation(operation.id, { state: "pending", attempts: operation.attempts + 1, lastError: undefined })
  try {
    const input = operation.input
    const credentials = accountCredentials(account)
    const result = await accessTokens.with(
      credentials,
      async (accessToken): Promise<GoogleCalendarProviderEvent | null> => {
        if (input.kind === "delete") {
          const headers = input.event.etag ? { "If-Match": input.event.etag } : undefined
          const url = `${eventsEndpoint}/${encodeURIComponent(input.event.providerId)}`
          const response = await net.fetch(url, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}`, ...headers },
            signal: AbortSignal.timeout(30_000),
          })
          if (response.status === 401) throw new Error("google_reconnect_required")
          if (response.status === 412) throw new Error("google_conflict")
          if (!response.ok && response.status !== 404) throw await providerError(response, url)
          return null
        }
        const id = input.kind === "create" ? googleEventId(input.idempotencyKey) : input.event.providerId
        const payload = {
          ...googleEventPayload(input.event),
          ...(input.kind === "create" ? { id } : {}),
        }
        const endpoint = input.kind === "create" ? eventsEndpoint : `${eventsEndpoint}/${encodeURIComponent(id)}`
        const headers = input.kind === "update" && input.event.etag ? { "If-Match": input.event.etag } : undefined
        const saved = await providerJson<GoogleEventResponse>(
          endpoint,
          accessToken,
          { method: input.kind === "create" ? "POST" : "PATCH", headers, body: JSON.stringify(payload) },
          account.id,
        ).catch((error) => {
          if (input.kind !== "create" || !(error instanceof Error) || error.message !== "google_http_409") throw error
          // The ID is taken, so an earlier attempt did reach Google; an edit since then still has to.
          return providerJson<GoogleEventResponse>(
            `${eventsEndpoint}/${encodeURIComponent(id)}`,
            accessToken,
            operation.reached ? { method: "PATCH", body: JSON.stringify(googleEventPayload(input.event)) } : undefined,
            account.id,
          )
        })
        return normalizeGoogleEvent(saved, account.id) ?? null
      },
    )
    updateOperation(operation.id, { state: "succeeded", result, lastError: undefined })
    return { state: "synced" as const, event: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : "google_write_failed"
    const state = outboxFailureState(message, operation.attempts + 1)
    updateOperation(operation.id, { state, lastError: message })
    return { state, event: pendingEvent(operation.input) }
  }
}

async function retryOutbox(account: Account) {
  for (const operation of readOutbox()) {
    if (operation.accountId !== account.id) continue
    if (operation.state !== "pending" && operation.state !== "offline") continue
    await dispatch(account, operation)
  }
}

async function dispatchTask(account: Account, operation: StoredTaskOutbox) {
  updateTaskOperation(operation.id, { state: "pending", attempts: operation.attempts + 1, lastError: undefined })
  try {
    const input = operation.input
    const collection = `${tasksEndpoint}/${encodeURIComponent(input.task.taskListId)}/tasks`
    const result = await accessTokens.with(
      accountCredentials(account),
      async (accessToken): Promise<GoogleTaskProviderTask | null> => {
        if (input.kind === "delete") {
          const url = `${collection}/${encodeURIComponent(input.task.providerId)}`
          const response = await net.fetch(url, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              ...(input.task.etag ? { "If-Match": input.task.etag } : {}),
            },
            signal: AbortSignal.timeout(30_000),
          })
          if (response.status === 401) throw new Error("google_reconnect_required")
          if (response.status === 412) throw new Error("google_conflict")
          if (!response.ok && response.status !== 404) throw await providerError(response, url)
          return null
        }
        const endpoint =
          input.kind === "create" ? collection : `${collection}/${encodeURIComponent(input.task.providerId)}`
        const saved = await providerJson<GoogleTaskResponse>(
          endpoint,
          accessToken,
          {
            method: input.kind === "create" ? "POST" : "PATCH",
            headers: input.kind === "update" && input.task.etag ? { "If-Match": input.task.etag } : undefined,
            body: JSON.stringify(googleTaskPayload(input.task)),
          },
          account.id,
        )
        const task = normalizeGoogleTask(
          saved,
          { id: input.task.taskListId, title: input.task.taskListTitle },
          account.id,
        )
        if (!task) throw new Error("google_task_invalid_response")
        return task
      },
    )
    updateTaskOperation(operation.id, { state: "succeeded", result, lastError: undefined })
    return { state: "synced" as const, task: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : "google_task_write_failed"
    const state = outboxFailureState(message, operation.attempts + 1)
    updateTaskOperation(operation.id, { state, lastError: message })
    return { state, task: operation.input.kind === "delete" ? operation.input.task : operation.input.task }
  }
}

async function retryTaskOutbox(account: Account) {
  for (const operation of readTaskOutbox()) {
    if (operation.accountId !== account.id) continue
    if (operation.state !== "pending" && operation.state !== "offline") continue
    await dispatchTask(account, operation)
  }
}

function withoutEtag<T extends { etag?: string }>(item: T) {
  const { etag: _etag, ...fields } = item
  return fields as T
}

function pendingEvent(input: GoogleCalendarWrite) {
  if (input.kind === "delete") return input.event
  return {
    ...input.event,
    providerId: input.kind === "create" ? googleEventId(input.idempotencyKey) : input.event.providerId,
  }
}

function validateWrite(input: GoogleCalendarWrite) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 256) throw new Error("google_idempotency_invalid")
  if (!input.event.title.trim() || input.event.calendarId !== "primary") throw new Error("google_event_invalid")
  googleEventPayload(input.event)
  if (input.kind !== "create" && !input.event.providerId) throw new Error("google_provider_id_required")
}

function validateTaskWrite(input: GoogleTaskWrite) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 256) throw new Error("google_idempotency_invalid")
  if (!input.task.taskListId || input.task.taskListId.length > 1_024) throw new Error("google_task_list_invalid")
  googleTaskPayload(input.task)
  if (input.kind !== "create" && (!input.task.providerId || input.task.providerId.startsWith("pending:"))) {
    throw new Error("google_provider_id_required")
  }
}

function rangeDate(days: number) {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString()
}

async function secureStorageAvailable() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"
}

/** Accounts as stored, after moving a single-account store into the account list. */
function readStoredAccounts(): StoredAccount[] {
  const store = getStore(storeName)
  if (GOOGLE_LEGACY_KEYS.some((key) => store.has(key))) migrateLegacyStore()
  const value = store.get("accounts")
  if (!Array.isArray(value)) return []
  return value.filter((item): item is StoredAccount =>
    Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.clientId === "string"),
  )
}

function migrateLegacyStore() {
  const store = getStore(storeName)
  const migrated = migrateLegacyGoogleStore({
    read: (key) => store.get(key),
    id: randomUUID(),
    outbox: rawOutbox("outbox"),
    taskOutbox: rawOutbox("taskOutbox"),
  })
  if (migrated) {
    const accounts = store.get("accounts")
    store.set("accounts", [...(Array.isArray(accounts) ? accounts : []), migrated.account])
    store.set("outbox", migrated.outbox)
    store.set("taskOutbox", migrated.taskOutbox)
  }
  GOOGLE_LEGACY_KEYS.forEach((key) => store.delete(key))
}

/** Decrypted accounts; one whose secrets no longer decrypt is skipped rather than failing every account. */
async function readAccounts(): Promise<Account[]> {
  const accounts = await Promise.all(
    readStoredAccounts().map(async (account): Promise<Account | undefined> => {
      try {
        return {
          ...account,
          clientSecret: await decrypt(account.clientSecret, (fresh) =>
            replaceSecret(account.id, "clientSecret", account.clientSecret, fresh),
          ),
          refreshToken: await decrypt(account.refreshToken, (fresh) =>
            replaceSecret(account.id, "refreshToken", account.refreshToken, fresh),
          ),
          access: account.access === "write" ? ("write" as const) : ("read" as const),
        }
      } catch {
        return undefined
      }
    }),
  )
  return accounts.filter((account): account is Account => account !== undefined)
}

async function requireAccounts() {
  if (!(await secureStorageAvailable())) throw new Error("google_secure_storage_unavailable")
  const accounts = await readAccounts()
  if (accounts.length === 0) throw new Error("google_not_connected")
  return accounts
}

async function requireWriteAccount(accountId: string) {
  const account = (await requireAccounts()).find((item) => item.id === accountId)
  if (!account) throw new Error("google_account_not_found")
  if (account.access !== "write") throw new Error("google_write_consent_required")
  return account
}

async function saveAccount(account: Account) {
  const stored = {
    ...account,
    clientSecret: await encrypt(account.clientSecret),
    refreshToken: await encrypt(account.refreshToken),
  }
  const accounts = readStoredAccounts()
  getStore(storeName).set(
    "accounts",
    accounts.some((item) => item.id === account.id)
      ? accounts.map((item) => (item.id === account.id ? stored : item))
      : [...accounts, stored],
  )
}

function updateAccount(id: string, patch: Partial<StoredAccount>) {
  getStore(storeName).set(
    "accounts",
    readStoredAccounts().map((account) => (account.id === id ? { ...account, ...patch } : account)),
  )
}

/** Stores a re-encrypted secret unless the account was saved again in the meantime. */
function replaceSecret(id: string, field: "clientSecret" | "refreshToken", previous: string, fresh: string) {
  const accounts = readStoredAccounts()
  if (!accounts.some((account) => account.id === id && account[field] === previous)) return
  updateAccount(id, { [field]: fresh })
}

function accountCredentials(account: Account) {
  return {
    accountId: account.id,
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    refreshToken: account.refreshToken,
  }
}

function encrypt(value: string) {
  return encryptSecret(safeStorage, value)
}

function decrypt(value: string, onReEncrypt?: (encrypted: string) => void) {
  return decryptSecret(safeStorage, value, onReEncrypt)
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function rawOutbox(key: "outbox" | "taskOutbox") {
  const value = getStore(storeName).get(key)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is { id: string; accountId?: string } =>
    Boolean(item && typeof item === "object" && "id" in item),
  )
}

// Entries are tagged with their account by the migration; an untagged entry can no longer be routed.
function readOutbox() {
  return rawOutbox("outbox").filter((item): item is StoredOutbox => typeof item.accountId === "string")
}

function persistOutbox(value: StoredOutbox[]) {
  getStore(storeName).set("outbox", pruneOutbox(value))
}

function updateOperation(id: string, patch: Partial<StoredOutbox>) {
  persistOutbox(readOutbox().map((operation) => (operation.id === id ? { ...operation, ...patch } : operation)))
}

function readTaskOutbox() {
  return rawOutbox("taskOutbox").filter((item): item is StoredTaskOutbox => typeof item.accountId === "string")
}

function persistTaskOutbox(value: StoredTaskOutbox[]) {
  getStore(storeName).set("taskOutbox", pruneOutbox(value))
}

function updateTaskOperation(id: string, patch: Partial<StoredTaskOutbox>) {
  persistTaskOutbox(readTaskOutbox().map((operation) => (operation.id === id ? { ...operation, ...patch } : operation)))
}
