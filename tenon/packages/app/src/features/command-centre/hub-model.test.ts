import { describe, expect, test } from "bun:test"
import { hubAtWork, projectCrew, sessionHarness, sessionOrigin, type HubThread } from "./hub-model"

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

describe("hubAtWork", () => {
  const thread = (id: string, extra: Partial<HubThread> = {}): HubThread => ({
    id,
    title: id,
    harness: "claude-code",
    updated: 0,
    state: "running",
    waiting: 0,
    ...extra,
  })

  test("lists agents running or waiting across Projects, waiting ones first, newest first, and skips idle threads", () => {
    const agents = hubAtWork({
      projects: [
        { id: "acme", name: "Acme API" },
        { id: "site", name: "Marketing site" },
      ],
      threads: {
        acme: [
          thread("old", { updated: 1 }),
          thread("new", {
            updated: 5,
            model: { id: "opus-5.5", reasoningEffort: "medium" },
            todos: [
              { content: "Plan", status: "completed" },
              { content: "Write middleware", status: "in_progress" },
            ],
          }),
          thread("done", { state: "idle", updated: 9 }),
        ],
        site: [thread("ask", { state: "needs", harness: "codex", updated: 2 })],
      },
    })
    expect(agents.map((agent) => agent.id)).toEqual(["ask", "new", "old"])
    expect(agents[0]?.project).toEqual({ id: "site", name: "Marketing site" })
    expect(agents[1]).toMatchObject({ model: "opus-5.5 · Medium", step: { n: 2, of: 2, text: "Write middleware" } })
  })
})
