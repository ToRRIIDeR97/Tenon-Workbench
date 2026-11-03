import { createContext, onCleanup, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { SecondBrainRequestError, undoAgentWrite } from "@/features/second-brain/client"

/**
 * Agent writes from the server's `agent.write` events (tenon/src/agents/app-tools.ts): one entry per
 * write, updated from `started` to `done`. The thread that made a write shows it inline; every other
 * page shows the top pill.
 */

export const KINDS = ["note", "tasks", "calendar", "timeline", "email"] as const
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
  /** The assistant message and tool call that made the write; absent for external harnesses. */
  messageID?: string
  callID?: string
  directory: string
  kind: Kind
  phase: "started" | "done"
  target: string
  preview: unknown
  undo?: string
  open?: { page?: string; projectId?: string }
  failed: boolean
  /** When the write started (or first arrived). */
  at: number
  /** When its `done` was shown; undefined while it is still writing. */
  doneAt?: number
  undoState: UndoState
  /** Seen inline or dismissed: it gets no pill. */
  hidden: boolean
}

/** The write an `agent.write` event describes, or undefined for anything malformed. */
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
          },
        }
      : {}),
    failed: value.failed === true,
  } satisfies Omit<AgentWrite, "at" | "doneAt" | "undoState" | "hidden">
}

/** Where Open goes for a write, or undefined when it has no page to open (email drafts). */
export function openHref(write: Pick<AgentWrite, "kind" | "open" | "preview">) {
  if (write.kind === "note" && write.open?.page) return `/projects?page=${encodeURIComponent(write.open.page)}`
  // A note with a Project and no page is a log entry (log_append).
  if (write.kind === "note" && write.open?.projectId)
    return `/projects?project=${encodeURIComponent(write.open.projectId)}&tab=log`
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

/** The session a thread page shows (`/server/:key/session/:id`, legacy `/:dir/session/:id`). */
export function sessionFromPath(pathname: string) {
  return /^\/(?:server\/[^/]+|[^/]+)\/session\/([^/?#]+)/.exec(pathname)?.[1]
}

const LIMIT = 50
/** The least time a write stays in its writing presentation, so the preview can grow and type. */
export const MIN_WRITING_MS = 1_400

/** How long a saved write's pill stays up. */
export const PILL_HIDE_MS = 6_000

/**
 * The write the pill shows: the newest unseen write of another thread that is still writing or saved
 * within the pill's time, so leaving a thread never pops a pill for an old write.
 */
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

/** How much longer the `done` of a write that started at `startedAt` waits before it shows. */
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
          // A late `started` never undoes a `done` that arrived first.
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
    // The server often finishes a write milliseconds after starting it: hold the writing state so the
    // preview's typing and growth are visible. Failures show at once.
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
    /** The thread a page shows inline outside `/…/session/<id>`; its writes get no pill. */
    async undo(id: string) {
      const write = state.writes.find((item) => item.id === id)
      if (!write?.undo || write.undoState === "pending" || write.undoState === "undone") return
      update(id, { undoState: "pending" })
      const client = { server: serverSDK().server, fetch: platform.fetch, target: { directory: write.directory } }
      const next = await undoAgentWrite(client, write.undo).then(
        (): UndoState => "undone",
        (error): UndoState => (error instanceof SecondBrainRequestError && error.status === 409 ? "changed" : "failed"),
      )
      update(id, { undoState: next })
    },
  }
}

export type AgentWrites = ReturnType<typeof createAgentWrites>

const Context = createContext<AgentWrites>()

export function AgentWritesProvider(props: ParentProps) {
  const writes = createAgentWrites()
  return <Context.Provider value={writes}>{props.children}</Context.Provider>
}

/** The shared write list; undefined outside the app layout (tests, isolated pages). */
export const useAgentWrites = () => useContext(Context)

export function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}
