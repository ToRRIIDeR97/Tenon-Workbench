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

// How many of a director thread's newest messages are loaded when its thread was not open yet; a thread already
// loaded keeps what it has, and the reports already read are kept in the run.
const MESSAGE_LIMIT = 200
// The director's delegated tasks, and theirs.
const CHILD_DEPTH = 3

/**
 * Follows every running workflow run while the app is open. Nothing here polls: it loads each director thread (and
 * the threads under it) once through the synced store, then reacts when that store changes.
 *
 * - Reports: the director's finished assistant messages (never the user's brief, never the message still streaming)
 *   are parsed once each (`completedReports`) and applied with `applyReports`; the run is saved only when that
 *   changed it. A streamed token does no work here.
 * - Limits: when `stopReason` says the budget is spent or a round past the cap was reported, the director thread is
 *   interrupted, and once that succeeds the run becomes `over-budget` or `out-of-rounds`, unless it has left
 *   `running` meanwhile (the user paused or stopped it, or its reports finished it). The `halting` set stops a
 *   second interrupt while the first is in flight; a failed interrupt is asked again on the next change.
 *
 * It also returns what the run view needs to act on a run: pause, stop and resume, and a run's spend.
 */
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

  // The threads under a thread are only in the synced store once something loaded them (a later one arrives as an
  // event), so they are fetched once for the spend.
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

  // The director threads of running runs. A string, so the effect below runs when the set changes and not on every
  // round that is saved.
  const watched = createMemo(() =>
    store
      .runs()
      .filter((run) => run.status === "running")
      .map((run) => run.sessionID)
      .join("\n"),
  )
  const loaded = new Set<string>()
  // The reports of each finished message, by director thread and message ID.
  const reportCaches = new Map<string, Map<string, Report[]>>()
  createEffect(() => {
    const ids = watched() ? watched().split("\n") : []
    // A run that left `running` (paused, stopped) is loaded again when it resumes: its thread may be dropped from the
    // synced store meanwhile.
    loaded.forEach((sessionID) => {
      if (ids.includes(sessionID)) return
      loaded.delete(sessionID)
      reportCaches.delete(sessionID)
    })
    ids.forEach((sessionID) => {
      // A pinned thread is never dropped from the synced store while its run is followed.
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

  /** What the run has cost, and whether any of its threads reported a cost at all. */
  const usage = (run: WorkflowRun) => runUsage(sessions(), serverSync().session.data.message, run.sessionID)
  const halting = new Set<string>()
  createEffect(() => {
    store.runs().forEach((run) => {
      if (run.status !== "running" || halting.has(run.id)) return
      const reason = stopReason(run, usage(run).spent)
      if (!reason) return
      halting.add(run.id)
      void interrupt(run.sessionID).then(
        // Only while the run is still running: the user's Pause or Stop, or a `done` from the reports, stays.
        () => store.endRun(run.id, reason === "budget" ? "over-budget" : "out-of-rounds"),
        // The next change in the run or in what it cost asks again.
        () => halting.delete(run.id),
      )
    })
  })

  const finish = (run: WorkflowRun, status: RunStatus) =>
    interrupt(run.sessionID).then(() => store.setStatus(run.id, status))
  return {
    usage,
    /** Interrupts the director thread; the run is paused. Rejects when the request fails. */
    pause: (run: WorkflowRun) => finish(run, "paused"),
    /** Interrupts the director thread; the run is stopped. Rejects when the request fails. */
    stop: (run: WorkflowRun) => finish(run, "stopped"),
    /** Asks the paused director to carry on from where it stopped; the run is running again. */
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
