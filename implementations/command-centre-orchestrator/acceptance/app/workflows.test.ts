import { describe, expect, test } from "bun:test"
import {
  DEFAULT_WORKFLOWS,
  directorBrief,
  MAX_ROUNDS,
  validateWorkflow,
  WORKFLOW_RULES,
  type Workflow,
} from "../../../../tenon/packages/app/src/features/command-centre/workflows"

const workflow = (extra: Partial<Workflow> = {}): Workflow => ({
  id: "build-review",
  name: "Build and review",
  description: "Plan, build, check.",
  roles: [
    { id: "director", name: "Director", job: "Plans and hands out work.", harnessID: "claude-code", modelID: "fable-5-2", may: "direct" },
    { id: "implementor", name: "Implementor", job: "Writes the change.", harnessID: "claude-code", modelID: "opus-5-5", may: "edit" },
    { id: "reviewer", name: "Reviewer", job: "Checks the diff.", harnessID: "codex", may: "read" },
  ],
  maxRounds: 5,
  budgetUSD: 5,
  ...extra,
})

describe("AC-3.1 validation", () => {
  test("AC-3.1 a complete workflow is valid", () => {
    expect(validateWorkflow(workflow())).toEqual([])
    expect(validateWorkflow(workflow({ budgetUSD: undefined }))).toEqual([])
  })

  test("AC-3.1 each problem is reported by name", () => {
    expect(validateWorkflow(workflow({ name: "  " }))).toEqual(["name"])
    expect(validateWorkflow(workflow({ roles: [] }))).toContain("roles")
    expect(validateWorkflow(workflow({ maxRounds: 0 }))).toEqual(["rounds"])
    expect(validateWorkflow(workflow({ maxRounds: MAX_ROUNDS + 1 }))).toEqual(["rounds"])
    expect(validateWorkflow(workflow({ budgetUSD: 0 }))).toEqual(["budget"])
    const noDirector = workflow()
    noDirector.roles[0] = { ...noDirector.roles[0], may: "edit" }
    expect(validateWorkflow(noDirector)).toEqual(["director"])
    const noHarness = workflow()
    noHarness.roles[1] = { ...noHarness.roles[1], harnessID: "" }
    expect(validateWorkflow(noHarness)).toEqual(["role"])
  })

  test("AC-3.1 the built-in workflows have one director, first", () => {
    expect(DEFAULT_WORKFLOWS.length).toBeGreaterThan(0)
    for (const item of DEFAULT_WORKFLOWS) {
      expect(item.roles[0].may).toBe("direct")
      expect(item.roles.filter((role) => role.may === "direct")).toHaveLength(1)
      const filled = { ...item, roles: item.roles.map((role) => ({ ...role, harnessID: role.harnessID || "any" })) }
      expect(validateWorkflow(filled)).toEqual([])
    }
  })
})

describe("AC-3.2 director brief", () => {
  test("AC-3.2 the rules forbid pushing and merging", () => {
    expect(WORKFLOW_RULES.some((rule) => /push/i.test(rule))).toBe(true)
    expect(WORKFLOW_RULES.some((rule) => /merge/i.test(rule))).toBe(true)
  })

  test("AC-3.2 the brief carries the rules, the roles, the limits and the user's brief", () => {
    const text = directorBrief(workflow(), "Replace the tab strip with a rail.")
    for (const rule of WORKFLOW_RULES) expect(text).toContain(rule)
    for (const role of workflow().roles) {
      expect(text).toContain(role.name)
      expect(text).toContain(role.job)
      expect(text).toContain(role.harnessID)
      if (role.modelID) expect(text).toContain(role.modelID)
    }
    expect(text).toContain("5")
    expect(text).toContain("delegate_task")
    expect(text).toContain("[[round N | role | status]]")
    expect(text.trimEnd().endsWith("Replace the tab strip with a rail.")).toBe(true)
  })
})
