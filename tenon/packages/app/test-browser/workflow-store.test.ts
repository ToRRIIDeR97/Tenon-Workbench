import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { Platform } from "@/context/platform"
import { createWorkflowStore, newRun, WORKFLOWS_STORAGE_KEY } from "@/features/command-centre/workflow-store"
import { DEFAULT_WORKFLOWS, type Workflow } from "@/features/command-centre/workflows"

const custom = (id: string, name = id): Workflow => ({
  id,
  name,
  description: "",
  roles: [{ id: "d", name: "Director", job: "", harnessID: "claude-code", may: "direct" }],
  maxRounds: 2,
})
const builtIn = DEFAULT_WORKFLOWS[0]

describe("the persisted store", () => {
  // A web platform over the test DOM's localStorage, which a second store reads back as a restart would.
  const platform = { platform: "web" } as unknown as Platform

  test("workflows and runs persist and come back with the defaults merged in", () => {
    localStorage.clear()
    const saved = createRoot((dispose) => {
      const store = createWorkflowStore(platform)
      store.save({ ...builtIn, name: "Edited" })
      store.save(custom("mine"))
      store.addRun(
        newRun({ id: "run_1", workflow: custom("mine"), sessionID: "ses_1", project: "prj_1", startedAt: 5 }),
      )
      const result = { workflows: store.workflows().map((item) => item.id), runs: store.runs().map((run) => run.id) }
      dispose()
      return result
    })
    expect(saved).toEqual({ workflows: [builtIn.id, "mine"], runs: ["run_1"] })
    expect(
      Object.keys(localStorage)
        .filter((name) => name.endsWith(WORKFLOWS_STORAGE_KEY))
        .map((name) => localStorage.getItem(name)),
    ).toEqual([expect.stringContaining("run_1")])

    const restored = createRoot((dispose) => {
      const store = createWorkflowStore(platform)
      const result = {
        names: store.workflows().map((item) => item.name),
        runs: store.runs().map((run) => [run.id, run.status, run.rounds]),
      }
      dispose()
      return result
    })
    expect(restored.names).toEqual(["Edited", "mine"])
    expect(restored.runs).toEqual([["run_1", "running", []]])
  })

  test("removing a saved workflow persists too", () => {
    localStorage.clear()
    createRoot((dispose) => {
      const store = createWorkflowStore(platform)
      store.save(custom("mine"))
      store.remove("mine")
      dispose()
    })
    const names = createRoot((dispose) => {
      const result = createWorkflowStore(platform)
        .workflows()
        .map((item) => item.id)
      dispose()
      return result
    })
    expect(names).toEqual(DEFAULT_WORKFLOWS.map((item) => item.id))
  })
})
