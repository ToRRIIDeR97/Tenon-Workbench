import { describe, expect, test } from "bun:test"
import { appendRun, duplicateWorkflow, mergeWorkflows, newRun, removeWorkflow, saveWorkflow } from "./workflow-store"
import { DEFAULT_WORKFLOWS, directorBrief, validateWorkflow, WORKFLOW_RULES, type Workflow } from "./workflows"

const custom = (id: string, name = id): Workflow => ({
  id,
  name,
  description: "",
  roles: [{ id: "d", name: "Director", job: "", harnessID: "claude-code", may: "direct" }],
  maxRounds: 2,
})
const builtIn = DEFAULT_WORKFLOWS[0]

describe("saved workflows", () => {
  test("the built-in workflows come first, then the user's own in saved order", () => {
    expect(mergeWorkflows(undefined).map((item) => item.id)).toEqual(DEFAULT_WORKFLOWS.map((item) => item.id))
    const saved = [custom("b"), custom("a")]
    expect(mergeWorkflows(saved).map((item) => item.id)).toEqual([
      ...DEFAULT_WORKFLOWS.map((item) => item.id),
      "b",
      "a",
    ])
  })

  test("a saved edit of a built-in replaces it in place and leaves the rest as they were", () => {
    const edited = { ...builtIn, maxRounds: 7, roles: builtIn.roles.map((role) => ({ ...role, harnessID: "codex" })) }
    const merged = mergeWorkflows([custom("mine"), edited])
    expect(merged[0]).toEqual(edited)
    expect(merged.filter((item) => item.id === builtIn.id)).toHaveLength(1)
    expect(validateWorkflow(merged[0])).toEqual([])
    expect(merged.at(-1)?.id).toBe("mine")
  })

  test("saving replaces the entry of that ID or adds one; removing a built-in's edit restores the original", () => {
    const first = saveWorkflow([], custom("a"))
    const renamed = saveWorkflow(first, custom("a", "Renamed"))
    expect(renamed.map((item) => item.name)).toEqual(["Renamed"])
    expect(saveWorkflow(renamed, custom("b")).map((item) => item.id)).toEqual(["a", "b"])
    const edited = saveWorkflow([], { ...builtIn, name: "Mine" })
    expect(mergeWorkflows(edited)[0].name).toBe("Mine")
    expect(mergeWorkflows(removeWorkflow(edited, builtIn.id))[0]).toEqual(builtIn)
    expect(removeWorkflow(renamed, "a")).toEqual([])
  })

  test("a duplicate has its own ID and roles, so editing it leaves the original alone", () => {
    const copy = duplicateWorkflow(builtIn, "wf_copy", "Build and review (copy)")
    copy.roles[0].name = "Lead"
    expect(copy.id).toBe("wf_copy")
    expect(builtIn.roles[0].name).toBe("Director")
  })

  test("a damaged saved value falls back to the built-ins", () => {
    expect(mergeWorkflows({} as unknown as Workflow[]).map((item) => item.id)).toEqual(
      DEFAULT_WORKFLOWS.map((item) => item.id),
    )
  })
})

describe("started runs", () => {
  test("a run is recorded running, with no rounds, in the shape the run view reads", () => {
    const workflow = { ...custom("a"), budgetUSD: 5 }
    const run = newRun({ id: "run_1", workflow, sessionID: "ses_1", project: "prj_1", startedAt: 100 })
    expect(run).toEqual({
      id: "run_1",
      workflowID: "a",
      sessionID: "ses_1",
      project: "prj_1",
      startedAt: 100,
      maxRounds: 2,
      budgetUSD: 5,
      status: "running",
      rounds: [],
    })
    expect("budgetUSD" in newRun({ id: "r", workflow: custom("a"), sessionID: "s", project: "p", startedAt: 1 })).toBe(
      false,
    )
  })

  test("appending adds the run last and leaves the list passed in alone", () => {
    const first = newRun({ id: "run_1", workflow: custom("a"), sessionID: "s1", project: "p", startedAt: 1 })
    const second = newRun({ id: "run_2", workflow: custom("a"), sessionID: "s2", project: "p", startedAt: 2 })
    const before = [first]
    expect(appendRun(before, second).map((run) => run.id)).toEqual(["run_1", "run_2"])
    expect(before).toHaveLength(1)
  })
})

describe("the director brief for a built-in workflow", () => {
  test("repeats each rule once, and an unset model is not printed as undefined", () => {
    const filled = { ...builtIn, roles: builtIn.roles.map((role) => ({ ...role, harnessID: "codex" })) }
    const text = directorBrief(filled, "Ship it.")
    for (const rule of WORKFLOW_RULES) expect(text.split(rule)).toHaveLength(2)
    expect(text).not.toContain("undefined")
    expect(text).not.toContain("Model ID")
    expect(text.endsWith("Ship it.")).toBe(true)
  })
})
