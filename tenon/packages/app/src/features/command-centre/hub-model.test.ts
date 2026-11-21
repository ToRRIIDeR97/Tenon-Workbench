import { describe, expect, test } from "bun:test"
import { projectCrew, sessionHarness, sessionOrigin, type HubThread } from "./hub-model"

describe("sessionHarness", () => {
  test("reads normalized fields first, then the legacy metadata", () => {
    expect(sessionHarness({ harnessInstanceID: "codex", harnessModel: { id: "gpt-5.5" } }, "opencode")).toEqual({
      harness: "codex",
      model: { id: "gpt-5.5" },
    })
    expect(
      sessionHarness(
        { metadata: { harnessInstanceID: "opencode-acp", harnessModel: { id: "x/flash", reasoningEffort: "max" } } },
        "opencode",
      ),
    ).toEqual({ harness: "opencode-acp", model: { id: "x/flash", reasoningEffort: "max" } })
  })

  test("falls back when nothing names a harness, and drops malformed models", () => {
    expect(sessionHarness({ metadata: { harnessModel: { name: "no id" } } }, "opencode")).toEqual({
      harness: "opencode",
    })
    expect(sessionHarness(undefined, "opencode")).toEqual({ harness: "opencode" })
  })
})

describe("projectCrew with a Project lead", () => {
  const thread = (id: string, extra: Partial<HubThread> = {}): HubThread => ({
    id,
    title: id,
    harness: "claude-code",
    updated: 10,
    state: "idle",
    waiting: 0,
    ...extra,
  })

  test("the Project's own lead leads, its delegates join the crew, and it isn't listed as an agent", () => {
    const crew = projectCrew({
      now: 20,
      threads: [
        thread("lead", { origin: { sessionID: "cc", commandCentre: true, lead: true }, state: "running" }),
        thread("d1", { parentID: "lead", state: "running" }),
        thread("other"),
      ],
      commandCentre: [{ id: "cc", title: "Command Centre", harness: "claude-code" }],
    })
    expect(crew.lead).toMatchObject({ id: "lead", project: true, state: "running" })
    expect(crew.agents.map((agent) => [agent.id, agent.delegate === true])).toEqual([
      ["d1", true],
      ["other", false],
    ])
  })

  test("without a lead thread, the Command Centre thread that started work there leads", () => {
    const crew = projectCrew({
      now: 20,
      threads: [thread("task", { origin: { sessionID: "cc", commandCentre: true } })],
      commandCentre: [{ id: "cc", title: "Command Centre", harness: "claude-code" }],
    })
    expect(crew.lead).toMatchObject({ id: "cc", project: false })
    expect(crew.agents.map((agent) => agent.id)).toEqual(["task"])
  })

  test("sessionOrigin keeps the lead mark", () => {
    expect(sessionOrigin({ origin: { sessionID: "cc", commandCentre: true, lead: true } })).toEqual({
      sessionID: "cc",
      commandCentre: true,
      lead: true,
    })
  })
})
