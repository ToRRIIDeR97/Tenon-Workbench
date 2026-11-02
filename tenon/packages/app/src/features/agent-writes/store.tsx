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
  directory: string
  kind: Kind
  phase: "started" | "done"
  target: string
  preview: unknown
  undo?: string
  open?: { page?: string; projectId?: string }
  failed: boolean
  at: number
  undoState: UndoState
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
  } satisfies Omit<AgentWrite, "at" | "undoState" | "hidden">
}

/** Where Open goes for a write, or undefined when it has no page to open (email drafts). */
export function openHref(write: Pick<AgentWrite, "kind" | "open" | "preview">) {
  if (write.kind === "note" && write.open?.page) return `/notes?page=${encodeURIComponent(write.open.page)}`
  if (write.open?.projectId) return `/notes?project=${encodeURIComponent(write.open.projectId)}`
  if (write.kind === "timeline") {
    const projectId = (write.preview as TimelinePreview | undefined)?.projectId
    return projectId ? `/notes?project=${encodeURIComponent(projectId)}` : undefined
  }
  if (write.kind === "calendar" || write.kind === "tasks") return "/calendar"
  if (write.kind === "note") return "/notes"
  return undefined
}

/** The session a thread page shows (`/server/:key/session/:id`, legacy `/:dir/session/:id`). */
export function sessionFromPath(pathname: string) {
  return /^\/(?:server\/[^/]+|[^/]+)\/session\/([^/?#]+)/.exec(pathname)?.[1]
}

const LIMIT = 50

function createAgentWrites() {
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  // `focused`: a thread a page shows outside the thread route (the Command Centre's open thread).
  const [state, setState] = createStore<{ writes: AgentWrite[]; focused?: string }>({ writes: [] })

  const unsubscribe = serverSDK().event.listen((event) => {
    const write = parseAgentWrite(event.name, event.details as { type?: unknown; properties?: unknown })
    if (!write) return
    setState(
      "writes",
      produce((writes) => {
        const existing = writes.find((item) => item.id === write.id)
        if (existing) {
          // A late `started` never undoes a `done` that arrived first.
          if (existing.phase === "done" && write.phase === "started") return
          Object.assign(existing, write)
          return
        }
        writes.push({ ...write, at: Date.now(), undoState: "idle", hidden: false })
        if (writes.length > LIMIT) writes.splice(0, writes.length - LIMIT)
      }),
    )
  })
  onCleanup(unsubscribe)

  const update = (id: string, change: Partial<AgentWrite>) => setState("writes", (write) => write.id === id, change)

  return {
    writes: () => state.writes,
    forSession: (sessionID: string) => state.writes.filter((write) => write.sessionID === sessionID),
    hide: (id: string) => update(id, { hidden: true }),
    /** The thread a page shows inline outside `/…/session/<id>`; its writes get no pill. */
    focused: () => state.focused,
    focus: (sessionID: string | undefined) => setState("focused", sessionID),
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
