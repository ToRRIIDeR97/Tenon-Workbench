import { describe, expect, test } from "bun:test"
import {
  directorBrief,
  MAX_ROUNDS,
  validateWorkflow,
  WORKFLOW_RULES,
  type Workflow,
  type WorkflowRole,
} from "../../../../tenon/packages/app/src/features/command-centre/workflows"

const role = (id: string, may: WorkflowRole["may"], extra: Partial<WorkflowRole> = {}): WorkflowRole => ({
  id,
  name: `Role ${id}`,
  job: `Job of ${id}.`,
  harnessID: `harness-${id}`,
  may,
  ...extra,
})
const base = (extra: Partial<Workflow> = {}): Workflow => ({
  id: "w",
  name: "Research then write",
  description: "",
  roles: [role("lead", "direct"), role("writer", "edit")],
  maxRounds: 3,
  ...extra,
})

describe("AC-3.1 boundaries", () => {
  test("AC-3.1 the round limits themselves are valid; fractions and non-numbers are not", () => {
    expect(validateWorkflow(base({ maxRounds: 1 }))).toEqual([])
    expect(validateWorkflow(base({ maxRounds: MAX_ROUNDS }))).toEqual([])
    expect(validateWorkflow(base({ maxRounds: 2.5 }))).toEqual(["rounds"])
    expect(validateWorkflow(base({ maxRounds: Number.NaN }))).toEqual(["rounds"])
    expect(validateWorkflow(base({ maxRounds: -1 }))).toEqual(["rounds"])
  })

  test("AC-3.1 a single director is a valid workflow; a negative budget is not; a tiny one is", () => {
    expect(validateWorkflow(base({ roles: [role("solo", "direct")] }))).toEqual([])
    expect(validateWorkflow(base({ budgetUSD: -3 }))).toEqual(["budget"])
    expect(validateWorkflow(base({ budgetUSD: 0.01 }))).toEqual([])
  })

  test("AC-3.1 two directors, or a role with a blank name, is a role problem", () => {
    expect(validateWorkflow(base({ roles: [role("a", "direct"), role("b", "direct")] }))).toEqual(["role"])
    expect(validateWorkflow(base({ roles: [role("a", "direct"), role("b", "read", { name: " " })] }))).toEqual(["role"])
  })

  test("AC-3.1 several problems come back once each, in the documented order", () => {
    const broken = base({
      name: "",
      roles: [role("a", "edit", { harnessID: "" }), role("b", "read", { harnessID: " " })],
      maxRounds: 99,
      budgetUSD: 0,
    })
    expect(validateWorkflow(broken)).toEqual(["name", "director", "role", "rounds", "budget"])
  })

  test("AC-3.1 no roles reports roles and does not throw", () => {
    const problems = validateWorkflow(base({ roles: [] }))
    expect(problems).toContain("roles")
    expect(problems).not.toContain("role")
  })

  test("AC-3.1 validation does not change the workflow", () => {
    const input = base({ name: "  Padded  " })
    const copy = structuredClone(input)
    validateWorkflow(input)
    expect(input).toEqual(copy)
  })
})

describe("AC-3.2 boundaries", () => {
  test("AC-3.2 a role without a model is still named with its harness, and the round cap is the workflow's", () => {
    const text = directorBrief(base({ maxRounds: 7 }), "Summarise the papers.")
    expect(text).toContain("harness-writer")
    expect(text).toContain("Role writer")
    expect(text).toContain("7")
    expect(text).not.toContain("undefined")
  })

  test("AC-3.2 the user's brief is kept exactly, with its line breaks and brackets, at the end", () => {
    const brief = "Line one.\n\n- [[not a report]] keep this\n- second point"
    const text = directorBrief(base(), brief)
    expect(text.endsWith(brief) || text.trimEnd().endsWith(brief)).toBe(true)
    expect(text.indexOf(brief)).toBeGreaterThan(text.indexOf(WORKFLOW_RULES[0]))
  })

  test("AC-3.2 every rule appears once, and a model ID is included when set", () => {
    const text = directorBrief(base({ roles: [role("lead", "direct", { modelID: "model-x-9" }), role("writer", "edit")] }), "Go.")
    for (const rule of WORKFLOW_RULES) expect(text.split(rule)).toHaveLength(2)
    expect(text).toContain("model-x-9")
    expect(text).toContain("delegate_task")
    expect(text).toContain("[[round N | role | status]]")
  })
})
