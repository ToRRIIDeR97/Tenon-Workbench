import { createSimpleContext } from "@tenon/ui/context"
import { readPartText } from "@tenon/session-ui/message-part-text"
import { Harness } from "@tenon/schema/harness"
import { createEffect, createMemo, createResource, on } from "solid-js"
import { createStore } from "solid-js/store"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { commandDirectory, compactCommandMemory, readVault, type ModelChoice } from "@/features/second-brain/client"
import { Identifier } from "@/utils/id"

export type CommandThread = { id: string; title: string; directory: string; updated: number }
export type CommandMessage = { id: string; role: "user" | "assistant"; text: string; done: boolean }

const DAY = 24 * 60 * 60 * 1000

/** `<vault root>/.command-centre`, in the root's own separator style. */
export function commandDirectoryFor(root: string) {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/"
  return `${root.replace(/[\\/]+$/, "")}${separator}.command-centre`
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
    const [threads, { refetch }] = createResource(directory, async (folder) => {
      const result = await serverSDK().api.session.list({ directory: folder, parentID: null, limit: 100 })
      // Filter here too: an older server answers this list without the directory filter.
      return (result.data ?? [])
        .filter((session) => sameDirectory(session.location?.directory, folder))
        .map(
          (session): CommandThread => ({
            id: session.id,
            title: session.title,
            directory: session.location?.directory ?? folder,
            updated: session.time.updated,
          }),
        )
        .sort((left, right) => right.updated - left.updated)
    })
    const list = () => threads.latest ?? []
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
    createEffect(
      on(
        () => latest()?.id,
        (id) => id && sync(id),
      ),
    )

    // Compaction runs at most once a day, with the memory age from Settings › Command Centre. The time is
    // saved only after a run succeeds, so a failed run is tried again on the next workspace load.
    let compacting = false
    createEffect(
      on(workspace, (target) => {
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
      }),
    )

    /**
     * Send to `sessionID`, else the latest Command Centre thread, else a new one; `null` always starts a new
     * thread. Resolves with the thread id.
     */
    const send = async (text: string, sessionID?: string | null) => {
      const folder = directory()
      const target = workspace()
      if (!folder || !target || !text.trim()) return undefined
      setState({ sending: true, error: "" })
      try {
        const current = settings.commandCentre.current()
        const harnessID = Harness.InstanceID.make(current.harnessID ?? Harness.OpenCode)
        const harness = harnessID !== Harness.OpenCode
        const existing = sessionID === null ? undefined : (sessionID ?? latest()?.id)
        const create = async () => {
          // The server creates the vault's .command-centre folder; an older server without the route is fine.
          await commandDirectory(client(target)).catch(() => undefined)
          const info = await serverSDK().api.session.create({
            harnessInstanceID: harnessID,
            harnessModel: harness && current.modelID ? { id: current.modelID } : undefined,
            location: { directory: folder },
          })
          if (!info?.id) throw new Error("command_centre_thread_failed")
          return info.id
        }
        const id = existing ?? (await create())
        const model = harness ? undefined : modelChoice(current.modelID)
        await serverSDK()
          .ensureDirSdkContext(folder)
          .api.session.prompt({
            sessionID: id,
            id: Identifier.ascending("message"),
            text,
            harness,
            ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
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
      threads: list,
      loading: () => threads.loading || vault.loading,
      latest,
      messages,
      sync,
      lastReply: () =>
        messages(latest()?.id)
          .findLast((message) => message.role === "assistant")
          ?.text.trim()
          .replace(/\s+/g, " ") ?? "",
      sending: () => state.sending,
      error: () => state.error,
      send,
      refetch,
    }
  },
})
