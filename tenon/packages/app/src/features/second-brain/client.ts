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
  location?: { workspaceId?: string; displayPath: string; path?: string } | null
  cover?: string | null
  createdAt: string
  updatedAt: string
}
export type ProjectCreate = {
  name: string
  outcome: string
  templateId?: string
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
  threadDirectory: string
  threadDirectoryKind: "workspace" | "folder" | "project"
  workspace: ProjectWorkspace | null
  rootSessionCount: number
  lastActivityAt: number | null
}

type Target = { directory?: string; workspace?: string; header?: boolean }
type Client = {
  server: ServerConnection.Any
  fetch?: typeof globalThis.fetch
  target: Target
}

export class SecondBrainRequestError extends Error {
  constructor(
    readonly status: number,
    readonly reason?: string,
  ) {
    super(`Second Brain request failed with status ${status}`)
    this.name = "SecondBrainRequestError"
  }
}

export function requestErrorReason(body: unknown) {
  if (!body || typeof body !== "object" || !("data" in body)) return undefined
  const data = body.data
  if (!data || typeof data !== "object" || !("message" in data) || typeof data.message !== "string") return undefined
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

export const readProjectCover = (client: Client, id: string) =>
  request<{ dataUrl: string | null }>(client, `/second-brain/project/cover?id=${encodeURIComponent(id)}`)

export const writeProjectCover = (client: Client, id: string, dataUrl: string) =>
  request<ProjectRecord>(client, `/second-brain/project/cover?id=${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ dataUrl }),
  })

export const removeProjectCover = (client: Client, id: string) =>
  request<ProjectRecord>(client, `/second-brain/project/cover?id=${encodeURIComponent(id)}`, { method: "DELETE" })

export const listProjectThreads = (client: Client) => request<ProjectThreads[]>(client, "/second-brain/project-threads")

export type ScanResult = { folders: number; created: number; missing: ReadonlyArray<string> }

export const scanProjects = (client: Client) =>
  request<ScanResult>(client, "/second-brain/projects/scan", { method: "POST" })

export const linkProjectFolder = (client: Client, folder: string) =>
  request<ScanResult>(client, "/second-brain/projects/link", { method: "POST", body: JSON.stringify({ folder }) })

export const unlinkProjectFolder = (client: Client, folder: string) =>
  request<ScanResult>(client, "/second-brain/projects/unlink", { method: "POST", body: JSON.stringify({ folder }) })

export type FolderTrust = { root: string; trusted: boolean; withheld: ReadonlyArray<string> }

export const readFolderTrust = (client: Client) => request<FolderTrust>(client, "/config/trust")

export const approveFolder = (client: Client) => request<FolderTrust>(client, "/config/trust", { method: "POST" })

export type Instructions = { path: string; content: string | null }

export const readInstructions = (client: Client) => request<Instructions>(client, "/second-brain/instructions")

export const writeInstructions = (client: Client, content: string) =>
  request<Instructions>(client, "/second-brain/instructions", { method: "PUT", body: JSON.stringify({ content }) })

export const removeInstructions = (client: Client) =>
  request<Instructions>(client, "/second-brain/instructions", { method: "DELETE" })

export type VaultInfo = { root: string; workspace: { id: string; name: string; folder: string } }
export type VaultPageInfo = {
  id: string
  path: string
  title: string
  projectId: string | null
  properties: Record<string, unknown>
  updatedAt: string
}
export type VaultPage = { info: VaultPageInfo; body: string; revision: string }
export type VaultPageVersion = { revision: string; updatedAt: string }
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

export const listVaultPages = (client: Client, filter: { project?: string; search?: string } = {}) => {
  const query = new URLSearchParams()
  if (filter.project) query.set("project", filter.project)
  if (filter.search) query.set("search", filter.search)
  return request<VaultPageInfo[]>(client, `/second-brain/vault/pages${query.size ? `?${query}` : ""}`)
}

export const readVaultPage = (client: Client, path: string) =>
  request<VaultPage>(client, `/second-brain/vault/page?path=${encodeURIComponent(path)}`)

export type VaultBacklink = { path: string; title: string; projectId: string | null; snippet: string }

export const readVaultBacklinks = (client: Client, path: string) =>
  request<VaultBacklink[]>(client, `/second-brain/vault/backlinks?path=${encodeURIComponent(path)}`)

export const moveVaultPage = (
  client: Client,
  input: { path: string; expectedRevision: string; title?: string; projectId?: string | null },
) =>
  request<{ page: VaultPage; updatedLinks: number }>(client, "/second-brain/vault/page/move", {
    method: "POST",
    body: JSON.stringify(input),
  })

export type SearchEverywhere = {
  pages: ReadonlyArray<{ path: string; title: string; projectId: string | null; snippet: string }>
  tasks: ReadonlyArray<{ id: string; title: string; snippet: string }>
  events: ReadonlyArray<{ id: string; title: string; date: string; snippet: string }>
  threads: ReadonlyArray<{ id: string; title: string; directory: string; snippet: string; updated: number }>
}

export const searchEverywhere = (client: Client, query: string, limit = 8) =>
  request<SearchEverywhere>(
    client,
    `/second-brain/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
  )

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

export const removeVaultPage = (client: Client, path: string, revision: string) =>
  request<{ removed: true }>(
    client,
    `/second-brain/vault/page?path=${encodeURIComponent(path)}&expectedRevision=${encodeURIComponent(revision)}`,
    { method: "DELETE" },
  )

export const listVaultPageVersions = (client: Client, path: string) =>
  request<VaultPageVersion[]>(client, `/second-brain/vault/page/history?path=${encodeURIComponent(path)}`)

export const readVaultPageVersion = (client: Client, path: string, revision: string) =>
  request<{ revision: string; body: string }>(
    client,
    `/second-brain/vault/page/history?path=${encodeURIComponent(path)}&revision=${encodeURIComponent(revision)}`,
  )

export const setRoutineEnabled = async (client: Client, path: string, enabled: boolean) => {
  const page = await readVaultPage(client, path)
  return writeVaultPage(client, {
    path,
    body: page.body,
    title: page.info.title,
    properties: { ...page.info.properties, enabled },
    expectedRevision: page.revision,
  })
}

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

export const readProjectLog = (client: Client, projectId: string) =>
  request<LogEntry[]>(client, `/second-brain/vault/log?project=${encodeURIComponent(projectId)}`)

export const listVaultConflicts = (client: Client) => request<VaultConflict[]>(client, "/second-brain/vault/conflicts")

export const migrateVault = (client: Client) =>
  request<{ moved: number; backup: string }>(client, "/second-brain/vault/migrate", { method: "POST" })

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
  lastStatus: "running" | "done" | "failed" | "unfiled" | null
  hash: string
  needsApproval: boolean
  denied: ReadonlyArray<string>
}
export type ModelChoice = { providerID: string; modelID: string }
export type MemoryHit = { sessionID?: string; text: string; at: number }

export type CommandAction = {
  id: string
  at: number
  kind: "message" | "stop" | "start"
  sessionID: string
  title: string
  project?: string
  text?: string
  by: string
}

export const listRoutines = (client: Client) => request<Routine[]>(client, "/second-brain/routines")

export const runRoutine = (client: Client, id: string, model?: ModelChoice) =>
  request<{ threadId: string }>(client, `/second-brain/routines/${encodeURIComponent(id)}/run`, {
    method: "POST",
    body: JSON.stringify(model ? { model } : {}),
  })

export const approveRoutine = (client: Client, id: string, hash: string) =>
  request<{ approved: true }>(client, `/second-brain/routines/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: JSON.stringify({ hash }),
  })

export const commandDirectory = (client: Client) =>
  request<{ directory: string }>(client, "/command-centre/directory", { method: "POST" })

export const commandFolders = (client: Client) => request<{ folders: string[] }>(client, "/command-centre/folders")

export const searchCommandMemory = (client: Client, search: string) =>
  request<MemoryHit[]>(client, `/command-centre/memory?search=${encodeURIComponent(search)}`)

export const listCommandActions = (client: Client, since: number) =>
  request<CommandAction[]>(client, `/command-centre/actions?since=${since}`)

export type UsageTokens = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}
export type UsageSubagent = {
  name: string
  description?: string
  total?: number
  source: "harness" | "opencode-session" | "claude-transcript" | "thread"
  sessionID?: string
}
export type UsageThread = {
  id: string
  title: string
  directory: string
  harness: string
  model?: string
  total: number
  main: number
  cost: number
  at: number
  subagents: ReadonlyArray<UsageSubagent>
  subagentCount: number
  unreported: number
}
export type UsageHarness = {
  harness: string
  models: ReadonlyArray<string>
  total: number
  subagents: number
  unreported: number
  cost: number
}
export type UsageSummary = {
  since: number
  totals: UsageTokens
  cost: number
  threads: number
  days: ReadonlyArray<{ day: string; fresh: number; cached: number }>
  harnesses: ReadonlyArray<UsageHarness>
  heaviest: ReadonlyArray<UsageThread>
}

export const readUsage = (client: Client, input: { since: number; offset: number }) =>
  request<UsageSummary>(
    client,
    `/second-brain/usage?since=${Math.max(0, Math.floor(input.since))}&offset=${Math.trunc(input.offset)}`,
  )

export const compactCommandMemory = (client: Client, input: { days: number; model?: ModelChoice }) =>
  request<{ summarised: number; deleted: number }>(client, "/command-centre/memory/compact", {
    method: "POST",
    body: JSON.stringify(input),
  })

export const vaultPageSummary = (info: VaultPageInfo): NoteSummary => ({
  path: info.path,
  title: info.title,
  projectIds: info.projectId ? [info.projectId] : [],
  tags: [],
  links: [],
  updatedAt: info.updatedAt,
})
