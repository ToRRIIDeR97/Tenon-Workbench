import { createSimpleContext } from "@tenon/ui/context"
import { readPartText } from "@tenon/session-ui/message-part-text"
import { Harness } from "@tenon/schema/harness"
import { debounce } from "@solid-primitives/scheduled"
import { createEffect, createMemo, createResource, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { commandDirectory, compactCommandMemory, readVault, type ModelChoice } from "@/features/second-brain/client"
import { useAgentWrites, type AgentWrite } from "@/features/agent-writes/store"
import { Identifier } from "@/utils/id"
import { settled } from "@/utils/resource"
import { normalizeSessionInfo } from "@/utils/session"

export type CommandThread = {
  id: string
  title: string
  directory: string
  updated: number
  /** The server's session, for the thread actions the sidebar controller runs. */
  session: ReturnType<typeof normalizeSessionInfo>
}
export type CommandMessage = { id: string; role: "user" | "assistant"; text: string; done: boolean }
/** What a new thread runs on, from the composer's model pill; without it the Settings default applies. */
export type CommandChoice = {
  harnessID: Harness.InstanceID
  harnessModel?: Harness.ModelSelection
  model?: { providerID: string; modelID: string; variant?: string | null }
}

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

/** `<vault root>/.command-centre`, in the root's own separator style. */
export function commandDirectoryFor(root: string) {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/"
  return `${root.replace(/[\\/]+$/, "")}${separator}.command-centre`
}

/** Whether a thread's folder is the Command Centre's (`<vault root>/.command-centre`). */
export function isCommandThread(directory: string | undefined) {
  return !!directory && /(^|[\\/])\.command-centre[\\/]*$/.test(directory)
}

/** Directory equality across separators, trailing slashes and (Windows) letter case. */
export function sameDirectory(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false
  const fold = (value: string) => {
    const normal = value.replaceAll("\\", "/").replace(/\/+$/, "")
    return /^[a-z]:\//i.test(normal) ? normal.toLowerCase() : normal
  }
  return fold(left) === fold(right)
}

/** A `provider/model` model id as the server's ModelChoice. */
export function modelChoice(modelID: string | undefined): ModelChoice | undefined {
  const index = modelID?.indexOf("/") ?? -1
  if (!modelID || index <= 0 || index === modelID.length - 1) return undefined
  return { providerID: modelID.slice(0, index), modelID: modelID.slice(index + 1) }
}

/**
 * The writes of a thread's current turn: those since its latest user message (all of them when no
 * message is known yet), oldest first.
 */
export function turnWrites(writes: ReadonlyArray<AgentWrite>, turnStart: number | undefined) {
  return writes.filter((write) => turnStart === undefined || write.at >= turnStart)
}

/**
 * A thread's label: its title once the server has named it, else its first message (one line, cut at 80
 * characters), else nothing so the caller shows its own placeholder. New threads are titled "New session -
 * <ISO time>" until the title model answers.
 */
export function threadLabel(title: string, firstMessage: string | undefined) {
  if (title && !/^New session - \d{4}-\d{2}-\d{2}T/.test(title)) return title
  const line = firstMessage?.trim().replace(/\s+/g, " ") ?? ""
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/**
 * Whether a thread's agent is still working: the server says it is busy, its last reply isn't complete, or
 * the last message is the user's and no reply has started yet.
 */
export function threadWorking(
  status: string | undefined,
  messages: ReadonlyArray<Pick<CommandMessage, "role" | "done">>,
) {
  if (status !== undefined && status !== "idle") return true
  const last = messages.at(-1)
  return last !== undefined && (!last.done || (last.role === "user" && status === undefined))
}

/** Whether the daily compaction is due: never ran, or last ran a day or more ago. */
export function compactionDue(compactedAt: number | undefined, now: number) {
  return compactedAt === undefined || now - compactedAt >= DAY
}

/**
 * The Command Centre's threads, latest reply and composer, shared by the page and the K3 strip.
 * Its threads run in `<vault root>/.command-centre`, which no Project points at.
 */
export const { use: useCommandCentre, provider: CommandCentreProvider } = createSimpleContext({
  name: "CommandCentre",
  gate: false,
  init: () => {
    const layout = useLayout()
    const platform = usePlatform()
    const serverSDK = useServerSDK()
    const serverSync = useServerSync()
    const settings = useSettings()
    const [state, setState] = createStore({ sending: false, error: "" })
    const workspace = () => layout.home.workspace() ?? undefined
    const client = (directory: string) => ({
      server: serverSDK().server,
      fetch: platform.fetch,
      target: { directory },
    })
    // The vault root is machine-wide; the workspace only routes the request (as a header, so the URL is plain).
    const [vault] = createResource(workspace, (directory) =>
      readVault({ ...client(directory), target: { directory, header: true } }).catch(() => undefined),
    )
    const directory = createMemo(() => {
      const root = vault()?.root
      return root ? commandDirectoryFor(root) : undefined
    })
    const [threads, { refetch }] = createResource<CommandThread[], string>(directory, async (folder, info) => {
      const result = await serverSDK()
        .api.session.list({ directory: folder, parentID: null, limit: 100 })
        // A failed refresh keeps the last list; reading a failed resource would throw into the page.
        .catch(() => undefined)
      if (!result) return info.value ?? []
      // Filter here too: an older server answers this list without the directory filter.
      return (result.data ?? [])
        // The server's list keeps archived sessions.
        .filter((session) => sameDirectory(session.location?.directory, folder) && !session.time.archived)
        .map(
          (session): CommandThread => ({
            id: session.id,
            title: session.title,
            directory: session.location?.directory ?? folder,
            updated: session.time.updated,
            session: normalizeSessionInfo(session),
          }),
        )
        .sort((left, right) => right.updated - left.updated)
    })
    // Threads also change outside this client's sends: archives, deletes and routine runs. Debounced, because
    // a running turn updates its session often.
    const refresh = debounce(() => void refetch(), 500)
    onCleanup(() => refresh.clear())
    createEffect(() => {
      const unsubscribe = serverSDK().event.listen((e) => {
        const event = e.details
        if (event.type !== "session.created" && event.type !== "session.updated" && event.type !== "session.deleted")
          return
        if (sameDirectory(event.properties.info.directory, directory())) refresh()
      })
      onCleanup(unsubscribe)
    })
    // The synced session info carries the title the server sets after the first reply and the latest activity.
    const list = () =>
      (settled(threads) ?? [])
        .map((thread) => {
          const info = serverSync().session.get(thread.id)
          return {
            ...thread,
            title: info?.title ?? thread.title,
            updated: Math.max(thread.updated, info?.time.updated ?? 0),
          }
        })
        .sort((left, right) => right.updated - left.updated)
    const latest = () => list()[0]

    const messages = (sessionID: string | undefined): CommandMessage[] => {
      if (!sessionID) return []
      const data = serverSync().session.data
      return (data.message[sessionID] ?? []).flatMap((message) => {
        if (message.role !== "user" && message.role !== "assistant") return []
        const text = (data.part[message.id] ?? [])
          .flatMap((part) => (part.type === "text" ? [readPartText(data.part_text_accum_delta, part)] : []))
          .join("\n")
        return [
          {
            id: message.id,
            role: message.role,
            text,
            done: message.role === "user" || message.time.completed !== undefined,
          },
        ]
      })
    }
    const sync = (sessionID: string) => void serverSync().session.sync(sessionID)
    const agentWrites = useAgentWrites()
    // When the thread's latest turn began (its last user message), so writes can be grouped per turn.
    const turnStart = (sessionID: string) =>
      (serverSync().session.data.message[sessionID] ?? []).findLast((message) => message.role === "user")?.time.created
    const writes = (sessionID: string | undefined) =>
      sessionID && agentWrites ? turnWrites(agentWrites.forSession(sessionID), turnStart(sessionID)) : []
    createEffect(
      on(
        () => latest()?.id,
        (id) => id && sync(id),
      ),
    )

    // Compaction runs at most once a day, with the memory age from Settings › Command Centre. It is checked
    // on each workspace load and hourly while the app is open. The time is saved only after a run succeeds,
    // so a failed run is tried again on the next check.
    let compacting = false
    const compact = (target: string | undefined) => {
      if (!target || compacting) return
      const current = settings.commandCentre.current()
      const now = Date.now()
      if (!compactionDue(current.compactedAt, now)) return
      compacting = true
      void compactCommandMemory(client(target), { days: current.memoryDays, model: modelChoice(current.modelID) })
        .then((result) => {
          settings.commandCentre.set({ compactedAt: now })
          if (result.deleted > 0) void refetch()
        })
        .catch(() => undefined)
        .finally(() => {
          compacting = false
        })
    }
    createEffect(on(workspace, compact))
    const timer = setInterval(() => compact(workspace()), HOUR)
    onCleanup(() => clearInterval(timer))

    /**
     * Send to `sessionID`, else the latest Command Centre thread, else a new one; `null` always starts a new
     * thread. Resolves with the thread id.
     */
    const send = async (text: string, sessionID?: string | null, choice?: CommandChoice) => {
      const folder = directory()
      const target = workspace()
      if (!folder || !target || !text.trim()) return undefined
      setState({ sending: true, error: "" })
      try {
        const current = settings.commandCentre.current()
        const harnessID = choice?.harnessID ?? Harness.InstanceID.make(current.harnessID ?? Harness.OpenCode)
        const harness = harnessID !== Harness.OpenCode
        const harnessModel = choice ? choice.harnessModel : current.modelID ? { id: current.modelID } : undefined
        const existing = sessionID === null ? undefined : (sessionID ?? latest()?.id)
        const create = async () => {
          // The server creates the vault's .command-centre folder; an older server without the route is fine.
          await commandDirectory(client(target)).catch(() => undefined)
          const info = await serverSDK().api.session.create({
            harnessInstanceID: harnessID,
            harnessModel: harness ? harnessModel : undefined,
            location: { directory: folder },
          })
          if (!info?.id) throw new Error("command_centre_thread_failed")
          return info.id
        }
        const id = existing ?? (await create())
        const model = harness ? undefined : choice ? choice.model : modelChoice(current.modelID)
        await serverSDK()
          .ensureDirSdkContext(folder)
          .api.session.prompt({
            sessionID: id,
            id: Identifier.ascending("message"),
            text,
            harness,
            ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
            ...(!harness && choice?.model?.variant ? { variant: choice.model.variant } : {}),
          })
        sync(id)
        if (!existing) void refetch()
        return id
      } catch (error) {
        setState("error", error instanceof Error ? error.message : String(error))
        return undefined
      } finally {
        setState("sending", false)
      }
    }

    return {
      directory,
      /** The latest thread's last write in its current turn that can be undone, for the K3 strip. */
      lastWrite: () =>
        writes(latest()?.id).findLast((write) => write.phase === "done" && !!write.undo && !write.failed),
      undo: (id: string) => agentWrites?.undo(id),
      threads: list,
      loading: () => threads.loading || vault.loading,
      latest,
      messages,
      /** Whether the thread's agent is working on a reply. */
      working: (sessionID: string | undefined) =>
        !!sessionID && threadWorking(serverSync().session.data.session_status[sessionID]?.type, messages(sessionID)),
      /** The thread's label, or "" when it has neither a title nor a known first message. */
      label: (thread: CommandThread) =>
        threadLabel(thread.title, messages(thread.id).find((message) => message.role === "user")?.text),
      sync,
      lastReply: () =>
        messages(latest()?.id)
          .findLast((message) => message.role === "assistant")
          ?.text.trim()
          .replace(/\s+/g, " ") ?? "",
      sending: () => state.sending,
      error: () => state.error,
      clearError: () => setState("error", ""),
      send,
      refetch,
    }
  },
})
