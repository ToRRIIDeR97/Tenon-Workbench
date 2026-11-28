import { createContext, onCleanup, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { SecondBrainRequestError, undoAgentWrite } from "@/features/second-brain/client"
import { sessionHref } from "@/utils/session-route"

export const KINDS = ["note", "tasks", "calendar", "timeline", "email", "project", "thread", "steer", "stop"] as const
export const COMMAND_KINDS: ReadonlyArray<Kind> = ["project", "thread", "steer", "stop"]
export type Kind = (typeof KINDS)[number]
export type UndoState = "idle" | "pending" | "undone" | "changed" | "failed"

export type NotePreview = { title?: string; text?: string }
export type TasksPreview = { tasks?: ReadonlyArray<{ title: string; dueDate?: string }> }
export type CalendarPreview = { events?: ReadonlyArray<{ title: string; date?: string; start?: string; end?: string }> }
export type TimelinePreview = {
  projectId?: string
  items?: ReadonlyArray<{ id: string; title: string; kind?: string; status?: string; start?: string; end?: string }>
}
export type EmailPreview = { to?: string; subject?: string; body?: string }

export type AgentWrite = {
  id: string
  sessionID: string
  messageID?: string
  callID?: string
  directory: string
  kind: Kind
  phase: "started" | "done"
  target: string
  preview: unknown
  undo?: string
  open?: { page?: string; projectId?: string; session?: string }
  failed: boolean
  at: number
  doneAt?: number
  undoState: UndoState
  hidden: boolean
}

export function parseAgentWrite(directory: string, event: { type?: unknown; properties?: unknown }) {
  if (event.type !== "agent.write" || !event.properties || typeof event.properties !== "object") return undefined
  const value = event.properties as Record<string, unknown>
  if (typeof value.id !== "string" || typeof value.sessionID !== "string") return undefined
  if (!KINDS.includes(value.kind as Kind)) return undefined
  if (value.phase !== "started" && value.phase !== "done") return undefined
  const open = value.open && typeof value.open === "object" ? (value.open as Record<string, unknown>) : undefined
  return {
    id: value.id,
    sessionID: value.sessionID,
    ...(typeof value.messageID === "string" ? { messageID: value.messageID } : {}),
    ...(typeof value.callID === "string" ? { callID: value.callID } : {}),
    directory,
    kind: value.kind as Kind,
    phase: value.phase,
    target: typeof value.target === "string" ? value.target : "",
    preview: value.preview,
    ...(typeof value.undo === "string" ? { undo: value.undo } : {}),
    ...(open
      ? {
          open: {
            ...(typeof open.page === "string" ? { page: open.page } : {}),
            ...(typeof open.projectId === "string" ? { projectId: open.projectId } : {}),
            ...(typeof open.session === "string" ? { session: open.session } : {}),
          },
        }
      : {}),
    failed: value.failed === true,
  } satisfies Omit<AgentWrite, "at" | "doneAt" | "undoState" | "hidden">
}

export function openHref(
  write: Pick<AgentWrite, "kind" | "open" | "preview">,
  serverKey?: Parameters<typeof sessionHref>[0],
) {
  if (write.open?.session) return serverKey ? sessionHref(serverKey, write.open.session) : undefined
  if (write.kind === "note" && write.open?.page) return `/projects?page=${encodeURIComponent(write.open.page)}`
  if (write.kind === "note" && write.open?.projectId)
    return `/projects?project=${encodeURIComponent(write.open.projectId)}&section=log`
  if (write.open?.projectId) return `/projects?project=${encodeURIComponent(write.open.projectId)}`
  if (write.kind === "timeline") {
    const projectId = (write.preview as TimelinePreview | undefined)?.projectId
    return projectId ? `/projects?project=${encodeURIComponent(projectId)}` : undefined
  }
  if (write.kind === "calendar" || write.kind === "tasks") {
    const date =
      write.kind === "calendar"
        ? (write.preview as CalendarPreview | undefined)?.events?.[0]?.date
        : (write.preview as TasksPreview | undefined)?.tasks?.find((task) => task.dueDate)?.dueDate
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `/calendar?date=${date}` : "/calendar"
  }
  if (write.kind === "note") return "/projects"
  return undefined
}

export function writeTurn(
  write: Pick<AgentWrite, "messageID" | "at">,
  assistantParent: (messageID: string) => string | undefined,
  users: ReadonlyArray<{ id: string; time: { created: number } }>,
) {
  const parent = write.messageID ? assistantParent(write.messageID) : undefined
  if (parent) return parent
  return users.findLast((user) => user.time.created <= write.at)?.id
}

export function sessionFromPath(pathname: string) {
  return /^\/(?:server\/[^/]+|[^/]+)\/session\/([^/?#]+)/.exec(pathname)?.[1]
}

const LIMIT = 50
export const MIN_WRITING_MS = 1_400

export const PILL_HIDE_MS = 6_000

export function pillWrite(writes: ReadonlyArray<AgentWrite>, open: string | undefined, now: number) {
  return writes
    .filter(
      (write) =>
        !write.hidden &&
        write.sessionID !== open &&
        (write.phase === "started" || (write.doneAt !== undefined && now - write.doneAt < PILL_HIDE_MS)),
    )
    .at(-1)
}

export function writingHold(startedAt: number, now: number, reduced: boolean) {
  if (reduced) return 0
  return Math.max(0, startedAt + MIN_WRITING_MS - now)
}

function createAgentWrites() {
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const [state, setState] = createStore<{ writes: AgentWrite[] }>({ writes: [] })

  const apply = (write: NonNullable<ReturnType<typeof parseAgentWrite>>) =>
    setState(
      "writes",
      produce((writes) => {
        const now = Date.now()
        const existing = writes.find((item) => item.id === write.id)
        if (existing) {
          if (existing.phase === "done" && write.phase === "started") return
          Object.assign(existing, write, write.phase === "done" ? { doneAt: now } : {})
          return
        }
        writes.push({
          ...write,
          at: now,
          ...(write.phase === "done" ? { doneAt: now } : {}),
          undoState: "idle",
          hidden: false,
        })
        if (writes.length > LIMIT) writes.splice(0, writes.length - LIMIT)
      }),
    )
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const unsubscribe = serverSDK().event.listen((event) => {
    const write = parseAgentWrite(event.name, event.details as { type?: unknown; properties?: unknown })
    if (!write) return
    const existing = state.writes.find((item) => item.id === write.id)
    const hold =
      write.phase === "done" && !write.failed && existing?.phase === "started"
        ? writingHold(existing.at, Date.now(), prefersReducedMotion())
        : 0
    if (hold === 0) return apply(write)
    const timer = setTimeout(() => {
      timers.delete(timer)
      apply(write)
    }, hold)
    timers.add(timer)
  })
  onCleanup(() => {
    unsubscribe()
    for (const timer of timers) clearTimeout(timer)
  })

  const update = (id: string, change: Partial<AgentWrite>) => setState("writes", (write) => write.id === id, change)

  return {
    writes: () => state.writes,
    forSession: (sessionID: string) => state.writes.filter((write) => write.sessionID === sessionID),
    hide: (id: string) => update(id, { hidden: true }),
    async undo(id: string): Promise<UndoState | undefined> {
      const write = state.writes.find((item) => item.id === id)
      if (!write?.undo || write.undoState === "pending" || write.undoState === "undone") return write?.undoState
      update(id, { undoState: "pending" })
      const client = { server: serverSDK().server, fetch: platform.fetch, target: { directory: write.directory } }
      const next = await undoAgentWrite(client, write.undo).then(
        (): UndoState => "undone",
        (error): UndoState => (error instanceof SecondBrainRequestError && error.status === 409 ? "changed" : "failed"),
      )
      update(id, { undoState: next })
      return next
    },
  }
}

export type AgentWrites = ReturnType<typeof createAgentWrites>

const Context = createContext<AgentWrites>()

export function AgentWritesProvider(props: ParentProps) {
  const writes = createAgentWrites()
  return <Context.Provider value={writes}>{props.children}</Context.Provider>
}

export const useAgentWrites = () => useContext(Context)

export function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}
