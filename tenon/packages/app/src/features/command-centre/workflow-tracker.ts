import { Harness } from "@tenon/schema/harness"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { completedReports, runUsage } from "@/features/command-centre/workflow-reads"
import type { createWorkflowStore, WorkflowRun } from "@/features/command-centre/workflow-store"
import {
  applyReports,
  RESUME_TEXT,
  stopReason,
  type Report,
  type RunStatus,
} from "@/features/command-centre/workflow-runs"
import { Identifier } from "@/utils/id"
import { normalizeSessionInfo } from "@/utils/session"

type Store = ReturnType<typeof createWorkflowStore>

const MESSAGE_LIMIT = 200
const CHILD_DEPTH = 3

export function createWorkflowRuns(store: Store) {
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const sessions = () => Object.values(serverSync().session.data.info).flatMap((info) => (info ? [info] : []))

  const directoryApi = async (sessionID: string) => {
    const info = serverSync().session.get(sessionID) ?? (await serverSync().session.resolve(sessionID))
    return { info, api: serverSDK().ensureDirSdkContext(info.directory).api }
  }
  const interrupt = (sessionID: string) =>
    directoryApi(sessionID).then((thread) => thread.api.session.interrupt({ sessionID }))

  const loadChildren = async (sessionID: string, depth: number): Promise<void> => {
    const info = serverSync().session.get(sessionID)
    if (!info || depth >= CHILD_DEPTH) return
    const result = await serverSDK().client.session.children(
      { sessionID, directory: info.directory },
      { throwOnError: true },
    )
    const children = result.data.map((child) => serverSync().session.remember(normalizeSessionInfo(child)))
    await Promise.all(children.map((child) => loadChildren(child.id, depth + 1).catch(() => undefined)))
  }

  const watched = createMemo(() =>
    store
      .runs()
      .filter((run) => run.status === "running")
      .map((run) => run.sessionID)
      .join("\n"),
  )
  const loaded = new Set<string>()
  const reportCaches = new Map<string, Map<string, Report[]>>()
  createEffect(() => {
    const ids = watched() ? watched().split("\n") : []
    loaded.forEach((sessionID) => {
      if (ids.includes(sessionID)) return
      loaded.delete(sessionID)
      reportCaches.delete(sessionID)
    })
    ids.forEach((sessionID) => {
      serverSync().session.pin(sessionID)
      if (loaded.has(sessionID)) return
      loaded.add(sessionID)
      void serverSync()
        .session.sync(sessionID, { messageLimit: MESSAGE_LIMIT })
        .then(() => loadChildren(sessionID, 0))
        .catch(() => loaded.delete(sessionID))
    })
    onCleanup(() => ids.forEach((sessionID) => serverSync().session.unpin(sessionID)))
  })

  createEffect(() => {
    const data = serverSync().session.data
    store.runs().forEach((run) => {
      if (run.status !== "running" || data.message[run.sessionID] === undefined) return
      const cache = reportCaches.get(run.sessionID) ?? new Map<string, Report[]>()
      reportCaches.set(run.sessionID, cache)
      const next = applyReports(run, completedReports(data, run.sessionID, cache))
      if (next.status === run.status && JSON.stringify(next.rounds) === JSON.stringify(run.rounds)) return
      store.updateRun(next)
    })
  })

  const usage = (run: WorkflowRun) => runUsage(sessions(), serverSync().session.data.message, run.sessionID)
  const halting = new Set<string>()
  createEffect(() => {
    store.runs().forEach((run) => {
      if (run.status !== "running" || halting.has(run.id)) return
      const reason = stopReason(run, usage(run).spent)
      if (!reason) return
      halting.add(run.id)
      void interrupt(run.sessionID).then(
        () => store.endRun(run.id, reason === "budget" ? "over-budget" : "out-of-rounds"),
        () => halting.delete(run.id),
      )
    })
  })

  const finish = (run: WorkflowRun, status: RunStatus) =>
    interrupt(run.sessionID).then(() => store.setStatus(run.id, status))
  return {
    usage,
    pause: (run: WorkflowRun) => finish(run, "paused"),
    stop: (run: WorkflowRun) => finish(run, "stopped"),
    resume: async (run: WorkflowRun) => {
      const thread = await directoryApi(run.sessionID)
      const harness = (thread.info as { harnessInstanceID?: string }).harnessInstanceID
      await thread.api.session.prompt({
        sessionID: run.sessionID,
        id: Identifier.ascending("message"),
        text: RESUME_TEXT,
        harness: !!harness && harness !== Harness.OpenCode,
      })
      store.setStatus(run.id, "running")
    },
  }
}
