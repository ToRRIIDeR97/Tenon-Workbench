import { describe, expect, test } from "bun:test"
import {
  hubCards,
  modelLabel,
  projectCrew,
  sessionOrigin,
  todoStep,
  type HubProject,
  type HubThread,
} from "../../../../tenon/packages/app/src/features/command-centre/hub-model"

const hour = 3_600_000
const now = Date.UTC(2026, 10, 20, 12)

const thread = (id: string, extra: Partial<HubThread> = {}): HubThread => ({
  id,
  title: id,
  harness: "opencode-acp",
  updated: now - hour,
  state: "idle",
  waiting: 0,
  ...extra,
})
const project = (id: string, extra: Partial<HubProject> = {}): HubProject => ({
  id,
  name: id,
  outcome: `${id} outcome`,
  status: "active",
  progressPercent: 40,
  nextMilestone: "M0",
  ...extra,
})

describe("AC-9 sessionOrigin", () => {
  test("reads a V2 origin field and a V1 metadata origin", () => {
    expect(sessionOrigin({ origin: { sessionID: "ses_cc", commandCentre: true } })).toEqual({ sessionID: "ses_cc", commandCentre: true })
    expect(sessionOrigin({ metadata: { origin: { sessionID: "ses_cc", commandCentre: false } } })).toEqual({ sessionID: "ses_cc", commandCentre: false })
  })
  test("is undefined without one", () => {
    expect(sessionOrigin({ metadata: { harnessInstanceID: "codex" } })).toBeUndefined()
  })
})

describe("AC-11 todoStep", () => {
  test("the in-progress item, 1-based, of all items", () => {
    expect(
      todoStep([
        { content: "Set up", status: "completed" },
        { content: "Write the scene", status: "in_progress" },
        { content: "Run sweeps", status: "pending" },
      ]),
    ).toEqual({ n: 2, of: 3, text: "Write the scene" })
  })
  test("no todos, no step", () => {
    expect(todoStep([])).toBeUndefined()
    expect(todoStep(undefined)).toBeUndefined()
  })
})

describe("AC-12 modelLabel", () => {
  test("the harness's model name with the effort", () => {
    expect(
      modelLabel({ id: "opencode-go/deepseek-v4.1-flash", reasoningEffort: "max" }, { models: [{ id: "opencode-go/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" }] }),
    ).toBe("DeepSeek V4.1 Flash · Max")
  })
  test("the id after its last slash when the harness doesn't list it", () => {
    expect(modelLabel({ id: "opencode-go/deepseek-v4.1-flash" })).toBe("deepseek-v4.1-flash")
    expect(modelLabel(undefined)).toBeUndefined()
  })
})

describe("AC-13 hubCards", () => {
  test("a card per active Project with state, counts, harnesses and the newest running line", () => {
    const cards = hubCards({
      projects: [project("alpha"), project("old", { status: "archived" }), project("quiet")],
      threads: {
        alpha: [
          thread("t1", { state: "running", harness: "opencode-acp", updated: now - 5 * 60_000, title: "Benchmark scene", origin: { sessionID: "ses_cc", commandCentre: true } }),
          thread("t2", { state: "needs", waiting: 1, harness: "codex", updated: now - 9 * 60_000 }),
          thread("t3", { state: "running", harness: "opencode-acp", updated: now - 2 * 60_000, title: "Profiling" }),
        ],
        quiet: [thread("q1", { updated: now - 3 * hour, title: "Old work" })],
      },
      commandCentreHarness: "claude-code",
    })
    expect(cards.map((card) => card.id)).toEqual(["alpha", "quiet"])
    const alpha = cards[0]!
    expect(alpha).toMatchObject({ name: "alpha", outcome: "alpha outcome", milestone: "M0", progress: 40, state: "needs", working: 2, needs: 1 })
    expect(alpha.harnesses).toEqual(["claude-code", "opencode-acp", "codex"])
    expect(alpha.now).toMatchObject({ title: "Profiling", harness: "opencode-acp" })
    expect(cards[1]).toMatchObject({ state: "idle", working: 0, needs: 0, harnesses: [] })
    expect(cards[1]!.now).toMatchObject({ title: "Old work" })
  })
})

describe("AC-14 projectCrew", () => {
  test("the Command Centre lead and the active or recent threads, newest first, with steps", () => {
    const crew = projectCrew({
      now,
      threads: [
        thread("old", { updated: now - 30 * hour }),
        thread("w1", {
          state: "running",
          updated: now - 60_000,
          title: "Godot foundation",
          model: { id: "opencode-go/deepseek-v4.1-flash", reasoningEffort: "max" },
          origin: { sessionID: "ses_cc", commandCentre: true },
          todos: [
            { content: "Set up", status: "completed" },
            { content: "Write the scene", status: "in_progress" },
          ],
        }),
        thread("w2", { updated: now - 2 * hour, harness: "codex", title: "Unity foundation" }),
        thread("w3", { state: "needs", waiting: 1, updated: now - 10 * 60_000 }),
      ],
      commandCentre: [{ id: "ses_cc", title: "Alpha X FPS game brainstorm", harness: "claude-code", model: { id: "opus" } }],
      instances: { "opencode-acp": { models: [{ id: "opencode-go/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" }] } },
    })
    expect(crew.lead).toMatchObject({ id: "ses_cc", title: "Alpha X FPS game brainstorm", harness: "claude-code", model: "opus" })
    expect(crew.agents.map((agent) => agent.id)).toEqual(["w1", "w3", "w2"])
    expect(crew.agents[0]).toMatchObject({ title: "Godot foundation", harness: "opencode-acp", model: "DeepSeek V4.1 Flash · Max", state: "running", commandCentre: true, step: { n: 2, of: 2, text: "Write the scene" } })
    expect(crew.agents[1]).toMatchObject({ state: "needs", commandCentre: false })
    expect(crew.agents[2]).toMatchObject({ state: "done", harness: "codex" })
  })
})
