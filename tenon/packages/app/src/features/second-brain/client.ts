import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

export type NoteSummary = {
  path: string
  title: string
  projectIds: ReadonlyArray<string>
  tags: ReadonlyArray<string>
  links: ReadonlyArray<string>
  updatedAt: string
}
export type CalendarSource = "local" | "google"
export type CalendarSyncState = "local" | "pending" | "synced" | "offline" | "stale" | "conflict" | "failed"
export type CalendarEvent = {
  id: string
  title: string
  date: string
  endDate?: string
  start?: string
  end?: string
  details?: string
  projectId?: string
  /** The Google account of a provider event; absent on local events and on saves from before multiple accounts. */
  accountId?: string
  providerId?: string
  calendarId?: string
  etag?: string
  timezone?: string
  allDay?: boolean
  recurringSeriesId?: string
  participantCount?: number
  outboxKind?: "create" | "update" | "delete"
  outboxKey?: string
  source: CalendarSource
  syncState: CalendarSyncState
}
export type PlannerTask = {
  id: string
  title: string
  notes?: string
  projectId?: string
  dueDate?: string
  scheduledDate?: string
  start?: string
  end?: string
  completedAt?: string
  accountId?: string
  providerId?: string
  taskListId?: string
  taskListTitle?: string
  etag?: string
  outboxKind?: "create" | "update" | "delete"
  outboxKey?: string
  createdAt: string
  updatedAt: string
  source: CalendarSource
  syncState: CalendarSyncState
}
export type CalendarSnapshot = {
  version: 2
  revision: string
  events: ReadonlyArray<CalendarEvent>
  tasks: ReadonlyArray<PlannerTask>
}
export type ProjectStatus = "active" | "paused" | "archived"
export type ProjectRecord = {
  id: string
  folder: string
  name: string
  outcome: string
  templateId?: string | null
  instructions: string
  status: ProjectStatus
  progressPercent: number
  nextMilestone?: string | null
  blocker?: string | null
  tags: ReadonlyArray<string>
  /** `path` is the project folder: relative to the workspace root, or absolute for a linked folder. */
  location?: { workspaceId?: string; displayPath: string; path?: string } | null
  createdAt: string
  updatedAt: string
}
export type ProjectCreate = {
  name: string
  outcome: string
  instructions?: string
  tags?: ReadonlyArray<string>
  location?: ProjectRecord["location"]
}
export type ProjectUpdate = Partial<
  Pick<
    ProjectRecord,
    | "name"
    | "outcome"
    | "templateId"
    | "instructions"
    | "status"
    | "progressPercent"
    | "nextMilestone"
    | "blocker"
    | "tags"
    | "location"
  >
> & { expectedUpdatedAt?: string }

export type ProjectWorkspace = { id: string; worktree: string; name?: string }
export type ProjectThreads = {
  project: ProjectRecord
  /** Absolute directory where the Project's threads run; use it verbatim as the session directory. */
  threadDirectory: string
  threadDirectoryKind: "workspace" | "folder" | "project"
  workspace: ProjectWorkspace | null
  rootSessionCount: number
  lastActivityAt: number | null
}

/** `header` sends the directory as `x-opencode-directory` instead of a query parameter. */
type Target = { directory?: string; workspace?: string; header?: boolean }
type Client = {
  server: ServerConnection.Any
  fetch?: typeof globalThis.fetch
  target: Target
}

export class SecondBrainRequestError extends Error {
  /** `reason` is the server's validation code for a 400, such as `invalid_event`. */
  constructor(
    readonly status: number,
    readonly reason?: string,
  ) {
    super(`Second Brain request failed with status ${status}`)
    this.name = "SecondBrainRequestError"
  }
}

/** The validation code a 400 response carries as `{ data: { message } }`. */
export function requestErrorReason(body: unknown) {
  if (!body || typeof body !== "object" || !("data" in body)) return undefined
  const data = body.data
  if (!data || typeof data !== "object" || !("message" in data) || typeof data.message !== "string") return undefined
  // `vault_unavailable` alone carries a detail: the vault-relative file that could not be read.
  return /^[a-z0-9_]{1,64}$/.test(data.message) || data.message.startsWith("vault_unavailable: ")
    ? data.message
    : undefined
}

async function request<T>(client: Client, path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, client.server.http.url)
  if (client.target.workspace) url.searchParams.set("workspace", client.target.workspace)
  else if (client.target.directory && !client.target.header) url.searchParams.set("directory", client.target.directory)
  const auth = client.server.http.password
    ? `Basic ${authTokenFromCredentials({
        username: client.server.http.username,
        password: client.server.http.password,
      })}`
    : undefined
  const headers = new Headers(init?.headers)
  headers.set("Accept", "application/json")
  if (init?.body) headers.set("Content-Type", "application/json")
  if (auth) headers.set("Authorization", auth)
  if (client.target.header && client.target.directory && !client.target.workspace)
    headers.set("x-opencode-directory", encodeURIComponent(client.target.directory))
  const response = await (client.fetch ?? globalThis.fetch)(url, {
    ...init,
    headers,
  })
  if (!response.ok) {
    const reason =
      response.status === 400 ? requestErrorReason(await response.json().catch(() => undefined)) : undefined
    throw new SecondBrainRequestError(response.status, reason)
  }
  return (await response.json()) as T
}

export const readCalendar = (client: Client) => request<CalendarSnapshot>(client, "/second-brain/calendar")

export const writeCalendar = (
  client: Client,
  events: ReadonlyArray<CalendarEvent>,
  expectedRevision?: string,
  tasks: ReadonlyArray<PlannerTask> = [],
) =>
  request<CalendarSnapshot>(client, "/second-brain/calendar", {
    method: "PUT",
    body: JSON.stringify({ events, tasks, expectedRevision }),
  })

export const listProjects = (client: Client) => request<ProjectRecord[]>(client, "/second-brain/projects")

export const createProject = (client: Client, input: ProjectCreate) =>
  request<ProjectRecord>(client, "/second-brain/projects", { method: "POST", body: JSON.stringify(input) })

export const updateProject = (client: Client, id: string, input: ProjectUpdate) =>
  request<ProjectRecord>(client, `/second-brain/project?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

/** Projects with their resolved thread directory and root thread stats. */
export const listProjectThreads = (client: Client) => request<ProjectThreads[]>(client, "/second-brain/project-threads")

export type ScanResult = { folders: number; created: number; missing: ReadonlyArray<string> }

/** Give every folder in the workspace's projects folder, and every linked folder, a Project card. */
export const scanProjects = (client: Client) =>
  request<ScanResult>(client, "/second-brain/projects/scan", { method: "POST" })

/** Add an absolute folder from outside the workspace as one of its Projects. */
export const linkProjectFolder = (client: Client, folder: string) =>
  request<ScanResult>(client, "/second-brain/projects/link", { method: "POST", body: JSON.stringify({ folder }) })

export const unlinkProjectFolder = (client: Client, folder: string) =>
  request<ScanResult>(client, "/second-brain/projects/unlink", { method: "POST", body: JSON.stringify({ folder }) })

/** The target folder's own AGENTS.md; `content` is null when it has none. */
export type Instructions = { path: string; content: string | null }

export const readInstructions = (client: Client) => request<Instructions>(client, "/second-brain/instructions")

export const writeInstructions = (client: Client, content: string) =>
  request<Instructions>(client, "/second-brain/instructions", { method: "PUT", body: JSON.stringify({ content }) })

export const removeInstructions = (client: Client) =>
  request<Instructions>(client, "/second-brain/instructions", { method: "DELETE" })

/** The workspace's folder in the Tenon vault, where its pages, timelines and Project logs live. */
export type VaultInfo = { root: string; workspace: { id: string; name: string; folder: string } }
/** `path` is relative to the workspace's vault folder and uses `/` on every platform. */
export type VaultPageInfo = {
  id: string
  path: string
  title: string
  projectId: string | null
  properties: Record<string, unknown>
  updatedAt: string
}
export type VaultPage = { info: VaultPageInfo; body: string; revision: string }
export type TimelineItem = {
  id: string
  title: string
  kind: "task" | "milestone"
  status: "todo" | "doing" | "done"
  start?: string
  end?: string
}
export type Timeline = { projectId: string; revision: string; items: ReadonlyArray<TimelineItem>; progress: number }
export type LogEntry = { at: string; author: string; text: string; machine: string }
export type VaultConflict = { path: string; original: string }

export const readVault = (client: Client) => request<VaultInfo>(client, "/second-brain/vault")

/** Newest first. */
export const listVaultPages = (client: Client, filter: { project?: string; search?: string } = {}) => {
  const query = new URLSearchParams()
  if (filter.project) query.set("project", filter.project)
  if (filter.search) query.set("search", filter.search)
  return request<VaultPageInfo[]>(client, `/second-brain/vault/pages${query.size ? `?${query}` : ""}`)
}

export const readVaultPage = (client: Client, path: string) =>
  request<VaultPage>(client, `/second-brain/vault/page?path=${encodeURIComponent(path)}`)

/** With `projectId` the path may be relative to the Project's folder. A 409 means stale, or (with `create`) taken. */
export const writeVaultPage = (
  client: Client,
  input: {
    path: string
    body: string
    title?: string
    projectId?: string
    properties?: Record<string, unknown>
    expectedRevision?: string
    create?: boolean
  },
) =>
  request<VaultPage>(client, `/second-brain/vault/page?path=${encodeURIComponent(input.path)}`, {
    method: "PUT",
    body: JSON.stringify({
      body: input.body,
      title: input.title,
      projectId: input.projectId,
      properties: input.properties,
      expectedRevision: input.expectedRevision,
      create: input.create,
    }),
  })

export const readTimeline = (client: Client, projectId: string) =>
  request<Timeline>(client, `/second-brain/vault/timeline?project=${encodeURIComponent(projectId)}`)

export const writeTimeline = (
  client: Client,
  projectId: string,
  input: { items: ReadonlyArray<TimelineItem>; expectedRevision?: string },
) =>
  request<Timeline>(client, `/second-brain/vault/timeline?project=${encodeURIComponent(projectId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })

/** Newest first, merged from every machine's log file. */
export const readProjectLog = (client: Client, projectId: string) =>
  request<LogEntry[]>(client, `/second-brain/vault/log?project=${encodeURIComponent(projectId)}`)

export const listVaultConflicts = (client: Client) => request<VaultConflict[]>(client, "/second-brain/vault/conflicts")

/** Moves the workspace's pre-vault notes into the vault (with a backup); a repeat call moves nothing. */
export const migrateVault = (client: Client) =>
  request<{ moved: number; backup: string }>(client, "/second-brain/vault/migrate", { method: "POST" })

/**
 * Reverts one agent write by its undo token; a 409 means it was already undone or has changed since.
 * The folder travels in a header so the route's URL stays `/second-brain/writes/<token>/undo`.
 */
export const undoAgentWrite = (client: Client, token: string) =>
  request<{ undone: true }>({ ...client, target: {} }, `/second-brain/writes/${encodeURIComponent(token)}/undo`, {
    method: "POST",
    headers: client.target.directory ? { "x-tenon-directory": encodeURIComponent(client.target.directory) } : {},
  })

export type Routine = {
  id: string
  name: string
  path: string
  schedule: string
  enabled: boolean
  nextRun: string | null
  lastRun: string | null
  lastStatus: "running" | "done" | "failed" | null
}
export type ModelChoice = { providerID: string; modelID: string }
export type MemoryHit = { sessionID?: string; text: string; at: number }

export const listRoutines = (client: Client) => request<Routine[]>(client, "/second-brain/routines")

export const runRoutine = (client: Client, id: string, model?: ModelChoice) =>
  request<{ threadId: string }>(client, `/second-brain/routines/${encodeURIComponent(id)}/run`, {
    method: "POST",
    body: JSON.stringify(model ? { model } : {}),
  })

/** Creates the vault's `.command-centre` folder when missing and returns it. */
export const commandDirectory = (client: Client) =>
  request<{ directory: string }>(client, "/command-centre/directory", { method: "POST" })

/** Every Command Centre folder on this machine; a moved vault's threads stay in the earlier root's folder. */
export const commandFolders = (client: Client) => request<{ folders: string[] }>(client, "/command-centre/folders")

export const searchCommandMemory = (client: Client, search: string) =>
  request<MemoryHit[]>(client, `/command-centre/memory?search=${encodeURIComponent(search)}`)

export const compactCommandMemory = (client: Client, input: { days: number; model?: ModelChoice }) =>
  request<{ summarised: number; deleted: number }>(client, "/command-centre/memory/compact", {
    method: "POST",
    body: JSON.stringify(input),
  })

/** A vault page in the shape the Projects map and overview list notes in. The vault keeps no link index. */
export const vaultPageSummary = (info: VaultPageInfo): NoteSummary => ({
  path: info.path,
  title: info.title,
  projectIds: info.projectId ? [info.projectId] : [],
  tags: [],
  links: [],
  updatedAt: info.updatedAt,
})
