import { needsYou } from "@/pages/activity-runs"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
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
import {
  commandDirectory,
  commandFolders,
  compactCommandMemory,
  readVault,
  type ModelChoice,
} from "@/features/second-brain/client"
import { useAgentWrites, type AgentWrite } from "@/features/agent-writes/store"
import { Identifier } from "@/utils/id"
import { settled } from "@/utils/resource"
import { normalizeSessionInfo } from "@/utils/session"
import { promptRoute } from "./command-strip-target"

export type CommandThread = {
  id: string
  title: string
  directory: string
  updated: number
  session: ReturnType<typeof normalizeSessionInfo>
}
export type CommandMessage = { id: string; role: "user" | "assistant"; text: string; done: boolean }
export type CommandChoice = {
  harnessID: Harness.InstanceID
  harnessModel?: Harness.ModelSelection
  model?: { providerID: string; modelID: string; variant?: string | null }
}

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

export function commandDirectoryFor(root: string) {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/"
  return `${root.replace(/[\\/]+$/, "")}${separator}.command-centre`
}

export function isCommandThread(directory: string | undefined) {
  return !!directory && /(^|[\\/])\.command-centre[\\/]*$/.test(directory)
}

export function sameDirectory(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false
  const fold = (value: string) => {
    const normal = value.replaceAll("\\", "/").replace(/\/+$/, "")
    return /^[a-z]:\//i.test(normal) ? normal.toLowerCase() : normal
  }
  return fold(left) === fold(right)
}

export function modelChoice(modelID: string | undefined): ModelChoice | undefined {
  const index = modelID?.indexOf("/") ?? -1
  if (!modelID || index <= 0 || index === modelID.length - 1) return undefined
  return { providerID: modelID.slice(0, index), modelID: modelID.slice(index + 1) }
}

export function turnWrites(writes: ReadonlyArray<AgentWrite>, turnStart: number | undefined) {
  return writes.filter((write) => turnStart === undefined || write.at >= turnStart)
}

export function threadLabel(title: string, firstMessage: string | undefined) {
  if (title && !/^New session - \d{4}-\d{2}-\d{2}T/.test(title)) return title
  const line = firstMessage?.trim().replace(/\s+/g, " ") ?? ""
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

export function threadWorking(
  status: string | undefined,
  messages: ReadonlyArray<Pick<CommandMessage, "role" | "done">>,
) {
  if (status !== undefined && status !== "idle") return true
  const last = messages.at(-1)
  return last !== undefined && (!last.done || (last.role === "user" && status === undefined))
}

export type CommandTranscript = {
  message: Record<string, ReadonlyArray<Message> | undefined>
  part: Record<string, ReadonlyArray<Part> | undefined>
  part_text_accum_delta: Record<string, string>
}

export function commandMessages(data: CommandTranscript, sessionID: string | undefined): CommandMessage[] {
  if (!sessionID) return []
  return (data.message[sessionID] ?? []).flatMap((message) => {
    const state = messageState(message)
    return state ? [{ id: message.id, ...state, text: messageText(data, message.id) }] : []
  })
}

export function lastAskText(data: CommandTranscript, sessionID: string | undefined) {
  const ask = sessionID ? data.message[sessionID]?.findLast((message) => message.role === "user") : undefined
  return ask ? messageText(data, ask.id).trim().replace(/\s+/g, " ") : ""
}

export function lastReplyText(data: CommandTranscript, sessionID: string | undefined) {
  const reply = sessionID ? data.message[sessionID]?.findLast((message) => message.role === "assistant") : undefined
  return reply ? messageText(data, reply.id).trim() : ""
}

export function commandWorking(status: string | undefined, data: CommandTranscript, sessionID: string) {
  const last = data.message[sessionID]?.findLast((message) => messageState(message) !== undefined)
  const state = last && messageState(last)
  return threadWorking(status, state ? [state] : [])
}

export function commandLabel(title: string, data: CommandTranscript, sessionID: string) {
  if (threadLabel(title, undefined)) return title
  const first = data.message[sessionID]?.find((message) => message.role === "user")
  return threadLabel(title, first && messageText(data, first.id))
}

function messageState(message: Message) {
  if (message.role !== "user" && message.role !== "assistant") return undefined
  return { role: message.role, done: message.role === "user" || message.time.completed !== undefined }
}

export function messageText(data: CommandTranscript, messageID: string) {
  return (data.part[messageID] ?? [])
    .flatMap((part) => (part.type === "text" ? [readPartText(data.part_text_accum_delta, part)] : []))
    .join("\n")
}

export function compactionDue(compactedAt: number | undefined, now: number) {
  return compactedAt === undefined || now - compactedAt >= DAY
}

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
    const [vault] = createResource(workspace, (directory) =>
      readVault({ ...client(directory), target: { directory, header: true } }).catch(() => undefined),
    )
    const directory = createMemo(() => {
      const root = vault()?.root
      return root ? commandDirectoryFor(root) : undefined
    })
    const [threads, { refetch }] = createResource<CommandThread[], string>(directory, async (folder, info) => {
      const target = workspace()
      const known = target
        ? await commandFolders({ ...client(target), target: { directory: target, header: true } }).then(
            (result) => result.folders,
            () => [],
          )
        : []
      const folders = [folder, ...known.filter((item) => !sameDirectory(item, folder))]
      const results = await Promise.all(
        folders.map((item, index) => {
          const listed = serverSDK().api.session.list({ directory: item, parentID: null, limit: 100 })
          return index === 0 ? listed.catch(() => undefined) : listed.catch(() => ({ data: [] }))
        }),
      )
      if (!results[0]) return info.value ?? []
      return results
        .flatMap((result) => result?.data ?? [])
        .filter(
          (session) =>
            folders.some((item) => sameDirectory(session.location?.directory, item)) && !session.time.archived,
        )
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
    const list = createMemo(() =>
      (settled(threads) ?? [])
        .filter((thread) => !thread.session.parentID)
        .map((thread) => {
          const info = serverSync().session.get(thread.id)
          return {
            ...thread,
            title: info?.title ?? thread.title,
            updated: Math.max(thread.updated, info?.time.updated ?? 0),
          }
        })
        .sort((left, right) => right.updated - left.updated),
    )
    const latest = () => list()[0]

    const messages = (sessionID: string | undefined) => commandMessages(serverSync().session.data, sessionID)
    const lastReply = createMemo(() => lastReplyText(serverSync().session.data, latest()?.id))
    const lastAsk = createMemo(() => lastAskText(serverSync().session.data, latest()?.id))
    const sync = (sessionID: string) => void serverSync().session.sync(sessionID)
    const agentWrites = useAgentWrites()
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

    const createThread = async (folder: string, target: string, choice?: CommandChoice) => {
      const current = settings.commandCentre.current()
      const harnessID = choice?.harnessID ?? Harness.InstanceID.make(current.harnessID ?? Harness.OpenCode)
      const harnessModel = choice ? choice.harnessModel : current.modelID ? { id: current.modelID } : undefined
      await commandDirectory(client(target)).catch(() => undefined)
      const info = await serverSDK().api.session.create({
        harnessInstanceID: harnessID,
        harnessModel: harnessID !== Harness.OpenCode ? harnessModel : undefined,
        location: { directory: folder },
      })
      if (!info?.id) throw new Error("command_centre_thread_failed")
      return info.id
    }

    const send = async (text: string, sessionID?: string | null, choice?: CommandChoice) => {
      const folder = directory()
      const target = workspace()
      if (!folder || !target || !text.trim()) return undefined
      setState({ sending: true, error: "" })
      try {
        const current = settings.commandCentre.current()
        const newest = list().find((thread) => sameDirectory(thread.directory, folder))
        const existing = sessionID === null ? undefined : (sessionID ?? newest?.id)
        const thread = existing ? list().find((item) => item.id === existing) : undefined
        const { harness, model } = promptRoute({
          choice,
          defaults: {
            harnessID: Harness.InstanceID.make(current.harnessID ?? Harness.OpenCode),
            model: modelChoice(current.modelID),
          },
          thread: thread ? { harnessID: thread.session.harnessInstanceID ?? Harness.OpenCode } : undefined,
        })
        const id = existing ?? (await createThread(folder, target, choice))
        await serverSDK()
          .ensureDirSdkContext(folder)
          .api.session.prompt({
            sessionID: id,
            id: Identifier.ascending("message"),
            text,
            harness,
            ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
            ...(!harness && model?.variant ? { variant: model.variant } : {}),
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
      lastWrite: () =>
        writes(latest()?.id).findLast((write) => write.phase === "done" && !!write.undo && !write.failed),
      lastWriteOf: (sessionID: string | undefined) =>
        writes(sessionID).findLast((write) => write.phase === "done" && !!write.undo && !write.failed),
      replyOf: (sessionID: string | undefined) => lastReplyText(serverSync().session.data, sessionID),
      askOf: (sessionID: string | undefined) => lastAskText(serverSync().session.data, sessionID),
      waitingOn: (sessionID: string | undefined) => needsYou(serverSync().session.data, sessionID ?? "") > 0,
      undo: (id: string) => agentWrites?.undo(id),
      threads: list,
      tasks: createMemo(() => (settled(threads) ?? []).filter((thread) => !!thread.session.parentID)),
      loading: () => threads.loading || vault.loading,
      latest,
      messages,
      waiting: () => needsYou(serverSync().session.data, latest()?.id ?? "") > 0,
      working: (sessionID: string | undefined) =>
        !!sessionID &&
        commandWorking(serverSync().session.data.session_status[sessionID]?.type, serverSync().session.data, sessionID),
      label: (thread: CommandThread) => commandLabel(thread.title, serverSync().session.data, thread.id),
      sync,
      lastReply,
      lastAsk,
      sending: () => state.sending,
      error: () => state.error,
      clearError: () => setState("error", ""),
      send,
      create: async () => {
        const folder = directory()
        const target = workspace()
        if (!folder || !target) return undefined
        const id = await createThread(folder, target).catch((error: unknown) => {
          setState("error", error instanceof Error ? error.message : String(error))
          return undefined
        })
        if (id) void refetch()
        return id
      },
      refetch,
    }
  },
})
