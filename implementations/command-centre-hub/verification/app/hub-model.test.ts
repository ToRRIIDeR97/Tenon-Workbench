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
const now = Date.UTC(2026, 10, 21, 9)
const t = (id: string, extra: Partial<HubThread> = {}): HubThread => ({ id, title: id, harness: "codex", updated: now, state: "idle", waiting: 0, ...extra })
const p = (id: string, extra: Partial<HubProject> = {}): HubProject => ({ id, name: id, outcome: "", status: "active", progressPercent: 0, ...extra })

describe("AC-9 malformed origins", () => {
  test("wrong types and non-objects give undefined", () => {
    expect(sessionOrigin({ origin: { sessionID: "ses_a", commandCentre: "yes" } })).toBeUndefined()
    expect(sessionOrigin({ metadata: { origin: { commandCentre: true } } })).toBeUndefined()
    expect(sessionOrigin(null)).toBeUndefined()
    expect(sessionOrigin("ses_a")).toBeUndefined()
  })
})

describe("AC-11 steps without an item in progress", () => {
  test("the number completed and the last completed item", () => {
    expect(
      todoStep([
        { content: "A", status: "completed" },
        { content: "B", status: "completed" },
        { content: "C", status: "pending" },
      ]),
    ).toEqual({ n: 2, of: 3, text: "B" })
  })
  test("nothing started: zero and the first item; cancelled items still count", () => {
    expect(
      todoStep([
        { content: "Plan", status: "pending" },
        { content: "Dropped", status: "cancelled" },
      ]),
    ).toEqual({ n: 0, of: 2, text: "Plan" })
  })
})

describe("AC-12 labels without the catalogue", () => {
  test("a bare id with an effort, capitalised", () => {
    expect(modelLabel({ id: "gpt-5.5", reasoningEffort: "high" })).toBe("gpt-5.5 · High")
    expect(modelLabel({ id: "x/gpt-5.5" }, { models: [{ id: "other", name: "Other" }] })).toBe("gpt-5.5")
  })
})

describe("AC-13 edge Projects", () => {
  test("no Projects, no cards", () => {
    expect(hubCards({ projects: [], threads: {} })).toEqual([])
  })
  test("a paused Project is paused while nothing runs, running when something does", () => {
    const cards = hubCards({
      projects: [p("still", { status: "paused" }), p("busy", { status: "paused" }), p("empty")],
      threads: { still: [t("s1", { updated: now - hour })], busy: [t("b1", { state: "running" })] },
    })
    expect(cards.map((card) => card.state)).toEqual(["paused", "running", "idle"])
    expect(cards[2]!.now).toBeUndefined()
    expect(cards[2]!.harnesses).toEqual([])
  })
  test("the Command Centre's harness leads only when one of the Project's threads came from it", () => {
    const [plain, led] = hubCards({
      projects: [p("plain"), p("led")],
      threads: {
        plain: [t("x", { state: "running", harness: "opencode-acp" })],
        led: [t("y", { state: "running", harness: "codex", origin: { sessionID: "ses_cc", commandCentre: true } })],
      },
      commandCentreHarness: "claude-code",
    })
    expect(plain!.harnesses).toEqual(["opencode-acp"])
    expect(led!.harnesses).toEqual(["claude-code", "codex"])
  })
})

describe("AC-14 crew edges", () => {
  test("no Command Centre origin, or an unknown one, means no lead", () => {
    expect(projectCrew({ now, threads: [t("a", { state: "running" })], commandCentre: [] }).lead).toBeUndefined()
    expect(
      projectCrew({ now, threads: [t("a", { state: "running", origin: { sessionID: "ses_gone", commandCentre: true } })], commandCentre: [] }).lead,
    ).toBeUndefined()
  })
  test("the newest Command Centre origin picks the lead", () => {
    const crew = projectCrew({
      now,
      threads: [
        t("a", { updated: now - 2 * hour, origin: { sessionID: "ses_old", commandCentre: true } }),
        t("b", { updated: now - hour, origin: { sessionID: "ses_new", commandCentre: true } }),
      ],
      commandCentre: [
        { id: "ses_old", title: "Old plan", harness: "claude-code" },
        { id: "ses_new", title: "New plan", harness: "codex" },
      ],
    })
    expect(crew.lead).toMatchObject({ id: "ses_new", title: "New plan" })
  })
  test("idle threads count for 24 hours", () => {
    const crew = projectCrew({
      now,
      threads: [t("fresh", { updated: now - 23 * hour }), t("stale", { updated: now - 25 * hour })],
      commandCentre: [],
    })
    expect(crew.agents.map((agent) => agent.id)).toEqual(["fresh"])
    expect(crew.agents[0]!.step).toBeUndefined()
  })
})
