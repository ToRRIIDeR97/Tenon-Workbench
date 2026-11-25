import { createSimpleContext } from "@tenon/ui/context"
import { createStore } from "solid-js/store"
import type { Platform } from "@/context/platform"
import { Persist, persisted } from "@/utils/persist"
import type { Run, RunStatus } from "./workflow-runs"
import { createWorkflowRuns } from "./workflow-tracker"
import { DEFAULT_WORKFLOWS, type Workflow } from "./workflows"

export type WorkflowRun = Run

export const WORKFLOWS_STORAGE_KEY = "command-workflows.v1"

type Saved = { workflows: Workflow[]; runs: WorkflowRun[] }

export function mergeWorkflows(saved: ReadonlyArray<Workflow> | undefined, defaults = DEFAULT_WORKFLOWS): Workflow[] {
  const edits = Array.isArray(saved) ? saved : []
  return [
    ...defaults.map((item) => edits.find((edit) => edit.id === item.id) ?? item),
    ...edits.filter((edit) => !defaults.some((item) => item.id === edit.id)),
  ]
}

export function saveWorkflow(saved: ReadonlyArray<Workflow>, workflow: Workflow): Workflow[] {
  return saved.some((item) => item.id === workflow.id)
    ? saved.map((item) => (item.id === workflow.id ? workflow : item))
    : [...saved, workflow]
}

export function removeWorkflow(saved: ReadonlyArray<Workflow>, id: string): Workflow[] {
  return saved.filter((item) => item.id !== id)
}

export function duplicateWorkflow(workflow: Workflow, id: string, name: string): Workflow {
  return {
    ...workflow,
    id,
    name,
    roles: workflow.roles.map((role) => ({ ...role })),
  }
}

export function appendRun(runs: ReadonlyArray<WorkflowRun>, run: WorkflowRun): WorkflowRun[] {
  return [...runs, run]
}

export function updateRun(runs: ReadonlyArray<WorkflowRun>, id: string, run: WorkflowRun): WorkflowRun[] {
  return runs.map((item) => (item.id === id ? run : item))
}

export function setRunStatus(runs: ReadonlyArray<WorkflowRun>, id: string, status: RunStatus): WorkflowRun[] {
  return runs.map((item) => (item.id === id ? { ...item, status } : item))
}

export function endRunningRun(runs: ReadonlyArray<WorkflowRun>, id: string, status: RunStatus): WorkflowRun[] {
  return runs.map((item) => (item.id === id && item.status === "running" ? { ...item, status } : item))
}

export function removeRun(runs: ReadonlyArray<WorkflowRun>, id: string): WorkflowRun[] {
  return runs.filter((item) => item.id !== id)
}

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

export function workflowID(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function createWorkflowStore(platform?: Platform) {
  const [store, setStore, , ready] = persisted(
    Persist.global(WORKFLOWS_STORAGE_KEY),
    createStore<Saved>({ workflows: [], runs: [] }),
    platform,
  )
  return {
    ready,
    workflows: () => mergeWorkflows(store.workflows),
    runs: (): WorkflowRun[] => (Array.isArray(store.runs) ? store.runs : []),
    save: (workflow: Workflow) =>
      setStore("workflows", saveWorkflow(Array.isArray(store.workflows) ? store.workflows : [], workflow)),
    remove: (id: string) =>
      setStore("workflows", removeWorkflow(Array.isArray(store.workflows) ? store.workflows : [], id)),
    addRun: (run: WorkflowRun) => setStore("runs", appendRun(Array.isArray(store.runs) ? store.runs : [], run)),
    updateRun: (run: WorkflowRun) =>
      setStore("runs", updateRun(Array.isArray(store.runs) ? store.runs : [], run.id, run)),
    setStatus: (id: string, status: RunStatus) =>
      setStore("runs", setRunStatus(Array.isArray(store.runs) ? store.runs : [], id, status)),
    endRun: (id: string, status: RunStatus) =>
      setStore("runs", endRunningRun(Array.isArray(store.runs) ? store.runs : [], id, status)),
    removeRun: (id: string) => setStore("runs", removeRun(Array.isArray(store.runs) ? store.runs : [], id)),
  }
}

export const { use: useWorkflows, provider: WorkflowsProvider } = createSimpleContext({
  name: "Workflows",
  gate: false,
  init: () => {
    const store = createWorkflowStore()
    return { ...store, ...createWorkflowRuns(store) }
  },
})
