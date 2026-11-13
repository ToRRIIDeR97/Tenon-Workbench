import { createSimpleContext } from "@tenon/ui/context"
import { createStore } from "solid-js/store"
import type { Platform } from "@/context/platform"
import { Persist, persisted } from "@/utils/persist"
import type { Run, RunStatus } from "./workflow-runs"
import { createWorkflowRuns } from "./workflow-tracker"
import { DEFAULT_WORKFLOWS, type Workflow } from "./workflows"

/** A started workflow run, kept so the tracker and the run view can read it. Runs from Task 3 stored `rounds: []`. */
export type WorkflowRun = Run

/** The key under which the user's workflows and the started runs persist (global, per server scope on desktop). */
export const WORKFLOWS_STORAGE_KEY = "command-workflows.v1"

type Saved = { workflows: Workflow[]; runs: WorkflowRun[] }

/**
 * The built-in workflows (with the user's edits to them) followed by the user's own, in the order they were
 * saved. A saved entry with a built-in's ID replaces it; any other saved entry is the user's.
 */
export function mergeWorkflows(saved: ReadonlyArray<Workflow> | undefined, defaults = DEFAULT_WORKFLOWS): Workflow[] {
  const edits = Array.isArray(saved) ? saved : []
  return [
    ...defaults.map((item) => edits.find((edit) => edit.id === item.id) ?? item),
    ...edits.filter((edit) => !defaults.some((item) => item.id === edit.id)),
  ]
}

/** `saved` with `workflow` replacing the entry of the same ID, or added last. */
export function saveWorkflow(saved: ReadonlyArray<Workflow>, workflow: Workflow): Workflow[] {
  return saved.some((item) => item.id === workflow.id)
    ? saved.map((item) => (item.id === workflow.id ? workflow : item))
    : [...saved, workflow]
}

/** `saved` without the entry; for a built-in this undoes the user's edits to it. */
export function removeWorkflow(saved: ReadonlyArray<Workflow>, id: string): Workflow[] {
  return saved.filter((item) => item.id !== id)
}

/** A copy for "Duplicate": a new ID, and a name that says it is a copy. */
export function duplicateWorkflow(workflow: Workflow, id: string, name: string): Workflow {
  return {
    ...workflow,
    id,
    name,
    roles: workflow.roles.map((role) => ({ ...role })),
  }
}

/** The run list with `run` added last. */
export function appendRun(runs: ReadonlyArray<WorkflowRun>, run: WorkflowRun): WorkflowRun[] {
  return [...runs, run]
}

/** The run list with the run of that ID replaced by `run`; an unknown ID leaves the list as it was. */
export function updateRun(runs: ReadonlyArray<WorkflowRun>, id: string, run: WorkflowRun): WorkflowRun[] {
  return runs.map((item) => (item.id === id ? run : item))
}

/** The run list with that run's status changed; an unknown ID leaves the list as it was. */
export function setRunStatus(runs: ReadonlyArray<WorkflowRun>, id: string, status: RunStatus): WorkflowRun[] {
  return runs.map((item) => (item.id === id ? { ...item, status } : item))
}

/**
 * The run list with that run's status changed only if it is still `running`: a limit stop that lands after the user
 * paused or stopped the run, or after its reports finished it, leaves that status alone.
 */
export function endRunningRun(runs: ReadonlyArray<WorkflowRun>, id: string, status: RunStatus): WorkflowRun[] {
  return runs.map((item) => (item.id === id && item.status === "running" ? { ...item, status } : item))
}

/** The run list without that run. */
export function removeRun(runs: ReadonlyArray<WorkflowRun>, id: string): WorkflowRun[] {
  return runs.filter((item) => item.id !== id)
}

/** A run as Start records it. */
export function newRun(input: {
  id: string
  workflow: Workflow
  sessionID: string
  project: string
  startedAt: number
}): WorkflowRun {
  return {
    id: input.id,
    workflowID: input.workflow.id,
    sessionID: input.sessionID,
    project: input.project,
    startedAt: input.startedAt,
    maxRounds: input.workflow.maxRounds,
    ...(input.workflow.budgetUSD === undefined ? {} : { budgetUSD: input.workflow.budgetUSD }),
    status: "running",
    rounds: [],
  }
}

/** A short unique ID for a workflow or a run. */
export function workflowID(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** The persisted store behind the provider; the platform argument is for tests. */
export function createWorkflowStore(platform?: Platform) {
  const [store, setStore, , ready] = persisted(
    Persist.global(WORKFLOWS_STORAGE_KEY),
    createStore<Saved>({ workflows: [], runs: [] }),
    platform,
  )
  return {
    ready,
    /** The built-in workflows with the user's edits, then the user's own. */
    workflows: () => mergeWorkflows(store.workflows),
    runs: (): WorkflowRun[] => (Array.isArray(store.runs) ? store.runs : []),
    save: (workflow: Workflow) =>
      setStore("workflows", saveWorkflow(Array.isArray(store.workflows) ? store.workflows : [], workflow)),
    remove: (id: string) =>
      setStore("workflows", removeWorkflow(Array.isArray(store.workflows) ? store.workflows : [], id)),
    addRun: (run: WorkflowRun) => setStore("runs", appendRun(Array.isArray(store.runs) ? store.runs : [], run)),
    /** Replaces the run of that ID. */
    updateRun: (run: WorkflowRun) =>
      setStore("runs", updateRun(Array.isArray(store.runs) ? store.runs : [], run.id, run)),
    setStatus: (id: string, status: RunStatus) =>
      setStore("runs", setRunStatus(Array.isArray(store.runs) ? store.runs : [], id, status)),
    /** Sets the status only while the run is still `running`. */
    endRun: (id: string, status: RunStatus) =>
      setStore("runs", endRunningRun(Array.isArray(store.runs) ? store.runs : [], id, status)),
    removeRun: (id: string) => setStore("runs", removeRun(Array.isArray(store.runs) ? store.runs : [], id)),
  }
}

/** The saved workflows and started runs, with what acts on a run (pause, stop, resume), shared by the Command Centre page
 * and the run view. */
export const { use: useWorkflows, provider: WorkflowsProvider } = createSimpleContext({
  name: "Workflows",
  gate: false,
  init: () => {
    const store = createWorkflowStore()
    // Follows the running runs for as long as the app is open (reports, spend and limits).
    return { ...store, ...createWorkflowRuns(store) }
  },
})
