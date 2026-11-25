import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "@tenon/core/database/database"
import { TokenUsage } from "../../src/agents/token-usage"
import { HarnessSubagentTrace } from "@tenon/core/harness/subagent-trace"

const tokens = (input: number, output = 0, cacheRead = 0) => ({
  input,
  output,
  reasoning: 0,
  cacheRead,
  cacheWrite: 0,
})

const DAY = 24 * 60 * 60 * 1000
const NOV_24 = Date.UTC(2026, 10, 24, 12)

describe("TokenUsage.summarize", () => {
  test("adds reported subagent usage to the thread and harness, and counts unreported calls instead of zero", () => {
    const summary = TokenUsage.summarize({
      since: 0,
      offsetMinutes: 0,
      sessions: [{ id: "main", title: "Rate limiting", directory: "/acme" }],
      rows: [
        {
          session: "main",
          at: NOV_24,
          harness: "claude-code",
          model: "opus",
          tokens: tokens(100, 50, 1000),
          cost: 0.5,
          subagents: [{ name: "Explore", description: "Find the gateway", usage: tokens(200, 20) }, { name: "Plan" }],
        },
      ],
    })
    expect(TokenUsage.sum(summary.totals)).toBe(1150 + 220)
    expect(summary.cost).toBe(0.5)
    expect(summary.harnesses).toEqual([
      { harness: "claude-code", models: ["opus"], total: 1370, subagents: 220, unreported: 1, cost: 0.5 },
    ])
    expect(summary.heaviest[0]).toMatchObject({
      id: "main",
      title: "Rate limiting",
      harness: "claude-code",
      model: "opus",
      total: 1370,
      main: 1150,
      unreported: 1,
      subagentCount: 1,
      subagents: [{ name: "Explore", description: "Find the gateway", total: 220, source: "harness" }],
    })
  })

  test("folds child threads into their root once, as a subagent row", () => {
    const summary = TokenUsage.summarize({
      since: 0,
      offsetMinutes: 0,
      sessions: [
        { id: "root", title: "Billing", directory: "/billing" },
        { id: "child", title: "Port webhooks", directory: "/billing", parent: "root" },
        { id: "grandchild", title: "List calls", directory: "/billing", parent: "child" },
      ],
      rows: [
        { session: "root", at: NOV_24, harness: "opencode-acp", tokens: tokens(10), cost: 0, subagents: [] },
        { session: "child", at: NOV_24, harness: "opencode-acp", tokens: tokens(30), cost: 0, subagents: [] },
        { session: "grandchild", at: NOV_24, harness: "opencode-acp", tokens: tokens(5), cost: 0, subagents: [] },
      ],
    })
    expect(summary.threads).toBe(1)
    expect(TokenUsage.sum(summary.totals)).toBe(45)
    expect(summary.heaviest[0]).toMatchObject({ id: "root", main: 10, total: 45 })
    expect(summary.heaviest[0].subagents).toEqual([
      { name: "Port webhooks", total: 30, source: "thread", sessionID: "child" },
      { name: "List calls", total: 5, source: "thread", sessionID: "grandchild" },
    ])
    expect(summary.harnesses[0]).toMatchObject({ total: 45, subagents: 35 })
  })

  test("keeps the full subagent count when the list is capped", () => {
    const summary = TokenUsage.summarize({
      since: 0,
      offsetMinutes: 0,
      sessions: [{ id: "s", title: "t", directory: "/d" }],
      rows: [
        {
          session: "s",
          at: NOV_24,
          harness: "opencode-acp",
          tokens: tokens(1),
          cost: 0,
          subagents: Array.from({ length: TokenUsage.SUBAGENT_LIMIT + 3 }, (_, index) => ({
            name: `general ${index}`,
            usage: tokens(index + 1),
          })),
        },
      ],
    })
    expect(summary.heaviest[0].subagents).toHaveLength(TokenUsage.SUBAGENT_LIMIT)
    expect(summary.heaviest[0].subagentCount).toBe(TokenUsage.SUBAGENT_LIMIT + 3)
    expect(summary.heaviest[0].subagents[0].name).toBe(`general ${TokenUsage.SUBAGENT_LIMIT + 2}`)
  })

  test("buckets days in the viewer's timezone and splits cache reads from new tokens", () => {
    const late = Date.UTC(2026, 10, 24, 23, 30)
    const summary = TokenUsage.summarize({
      since: 0,
      offsetMinutes: -60,
      sessions: [{ id: "s", title: "t", directory: "/d" }],
      rows: [
        { session: "s", at: late, harness: "codex", tokens: tokens(10, 5, 100), cost: 0, subagents: [] },
        { session: "s", at: late - DAY, harness: "codex", tokens: tokens(1), cost: 0, subagents: [] },
      ],
    })
    expect(summary.days).toEqual([
      { day: "2026-11-24", fresh: 1, cached: 0 },
      { day: "2026-11-25", fresh: 15, cached: 100 },
    ])
  })

  test("survives cycles in parent links and missing sessions", () => {
    const summary = TokenUsage.summarize({
      since: 0,
      offsetMinutes: 0,
      sessions: [
        { id: "a", title: "A", directory: "/", parent: "b" },
        { id: "b", title: "B", directory: "/", parent: "a" },
      ],
      rows: [
        { session: "a", at: NOV_24, harness: "opencode", tokens: tokens(1), cost: 0, subagents: [] },
        { session: "gone", at: NOV_24, harness: "opencode", tokens: tokens(2), cost: 0, subagents: [] },
      ],
    })
    expect(TokenUsage.sum(summary.totals)).toBe(3)
    expect(summary.heaviest.find((thread) => thread.id === "gone")).toMatchObject({ title: "", total: 2 })
  })

  test("reads harness subagent usage in either field order and drops empty reports", () => {
    expect(
      TokenUsage.subagentCalls(
        JSON.stringify([
          { name: "explore", usage: { inputTokens: 3, outputTokens: 1, cachedReadTokens: 7 } },
          { name: "general", usage: { inputTokens: 0 } },
          "junk",
        ]),
      ),
    ).toEqual([
      { name: "explore", usage: { input: 3, output: 1, reasoning: 0, cacheRead: 7, cacheWrite: 0 } },
      { name: "general" },
    ])
    expect(TokenUsage.messageTokens('{"input":2,"output":3,"reasoning":1,"cache":{"read":4,"write":5}}')).toEqual({
      input: 2,
      output: 3,
      reasoning: 1,
      cacheRead: 4,
      cacheWrite: 5,
    })
    expect(TokenUsage.messageTokens("not json")).toBeUndefined()
  })
})

describe("TokenUsage.read", () => {
  test("reads assistant messages, subagent tool results and legacy messages from the database", async () => {
    const file = await cacheFile()
    const traced: HarnessSubagentTrace.Ref[] = []
    const summary = await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db.run(sql.raw("PRAGMA foreign_keys = OFF"))
        const session = (id: string, parent: string | null) =>
          db.run(
            sql`insert into session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
                  values (${id}, 'p', ${parent}, ${id}, '/work', ${`Thread ${id}`}, '1', ${NOV_24}, ${NOV_24})`,
          )
        yield* session("root", null)
        yield* session("child", "root")
        const assistant = {
          harnessInstanceID: "opencode-acp",
          model: { id: "kimi" },
          tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 100, write: 0 } },
          cost: 0.25,
          content: [
            { type: "text", text: "hello" },
            {
              type: "tool",
              name: "acp_subagent",
              state: { input: { agent: "explore", description: "Scan the API", prompt: "secret prompt" } },
              provider: { resultMetadata: { acp: { usage: { inputTokens: 40, outputTokens: 4 } } } },
            },
            {
              type: "tool",
              name: "acp_subagent",
              state: {
                input: { agent: "general" },
                result: { type: "text", value: '<subagent sessionID="ses_traced" state="completed">ok</subagent>' },
              },
            },
          ],
        }
        yield* db.run(
          sql`insert into session_message (id, session_id, type, seq, time_created, time_updated, data)
                values ('m1', 'root', 'assistant', 1, ${NOV_24}, ${NOV_24}, ${JSON.stringify(assistant)}),
                       ('m2', 'root', 'user', 2, ${NOV_24}, ${NOV_24}, '{"tokens":{"input":999}}'),
                       ('m3', 'root', 'assistant', 3, ${NOV_24 - 40 * DAY}, ${NOV_24}, ${JSON.stringify(assistant)})`,
        )
        yield* db.run(
          sql`insert into message (id, session_id, time_created, time_updated, data)
                values ('l1', 'child', ${NOV_24}, ${NOV_24}, ${JSON.stringify({ role: "assistant", modelID: "nemotron", tokens: { input: 7, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 })})`,
        )
        return yield* TokenUsage.read({
          since: NOV_24 - DAY,
          offsetMinutes: 0,
          cacheFile: file,
          trace: (refs) => {
            traced.push(...refs)
            return Effect.succeed(new Map([["opencode-session:ses_traced", { inputTokens: 6 }]]))
          },
        })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:"))),
    )
    expect(traced).toEqual([{ kind: "opencode-session", id: "ses_traced", directory: "/work" }])
    expect(TokenUsage.sum(summary.totals)).toBe(112 + 44 + 6 + 8)
    expect(summary.cost).toBe(0.25)
    expect(summary.harnesses.map((item) => [item.harness, item.total, item.subagents, item.unreported])).toEqual([
      ["opencode-acp", 162, 50, 0],
      ["opencode", 8, 8, 0],
    ])
    expect(summary.heaviest).toHaveLength(1)
    expect(summary.heaviest[0]).toMatchObject({ id: "root", title: "Thread root", main: 112, total: 170 })
    expect(summary.heaviest[0].subagents.map((item) => [item.name, item.total, item.source])).toEqual([
      ["explore", 44, "harness"],
      ["Thread child", 8, "thread"],
      ["general", 6, "opencode-session"],
    ])
    expect(JSON.stringify(summary)).not.toContain("secret prompt")
  })
})

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const cacheFile = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tenon-usage-cache-"))
  dirs.push(dir)
  return path.join(dir, TokenUsage.CACHE_FILE)
}

describe("TokenUsage.traceUnreported", () => {
  const rows = (session: string): TokenUsage.Row[] => [
    {
      session,
      at: NOV_24,
      harness: "opencode-acp",
      tokens: tokens(1),
      cost: 0,
      subagents: [
        { name: "general", output: `<subagent sessionID="ses_${session}A" state="completed">done</subagent>` },
        { name: "explore", output: `<subagent sessionID="ses_${session}B" state="completed">done</subagent>` },
        { name: "reported", usage: tokens(9) },
      ],
    },
  ]

  test("fills unreported subagents from the trace, labels the source and caches hits only", async () => {
    const file = await cacheFile()
    const asked: string[][] = []
    const trace: TokenUsage.Trace = (refs) => {
      asked.push(refs.map((item) => item.id))
      return Effect.succeed(new Map([[`opencode-session:ses_oneA`, { inputTokens: 40, outputTokens: 2 }]]))
    }
    const directories = new Map([["one", "/work"]])
    const first = await Effect.runPromise(
      TokenUsage.traceUnreported({ rows: rows("one"), directories, trace, cacheFile: file, now: NOV_24 }),
    )
    expect(asked).toEqual([["ses_oneA", "ses_oneB"]])
    expect(
      first[0]?.subagents.map((call) => [call.name, call.source, call.usage && TokenUsage.sum(call.usage)]),
    ).toEqual([
      ["general", "opencode-session", 42],
      ["explore", undefined, undefined],
      ["reported", undefined, 9],
    ])
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      "opencode-session:ses_oneA": { input: 40, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    })

    const again = await Effect.runPromise(
      TokenUsage.traceUnreported({ rows: rows("one"), directories, trace, cacheFile: file, now: NOV_24 + 1000 }),
    )
    expect(asked).toHaveLength(1)
    expect(again[0]?.subagents[0]?.source).toBe("opencode-session")

    await Effect.runPromise(
      TokenUsage.traceUnreported({
        rows: rows("one"),
        directories,
        trace,
        cacheFile: file,
        now: NOV_24 + TokenUsage.TRACE_RETRY_MS + 1,
      }),
    )
    expect(asked[1]).toEqual(["ses_oneB"])
  })

  test("a failing trace leaves calls unreported and lets the next load try again", async () => {
    const file = await cacheFile()
    const directories = new Map([["two", "/work"]])
    const failed = await Effect.runPromise(
      TokenUsage.traceUnreported({
        rows: rows("two"),
        directories,
        trace: () => Effect.die(new Error("opencode missing")),
        cacheFile: file,
        now: NOV_24,
      }),
    )
    expect(failed[0]?.subagents.map((call) => call.usage === undefined)).toEqual([true, true, false])
    const asked: string[] = []
    await Effect.runPromise(
      TokenUsage.traceUnreported({
        rows: rows("two"),
        directories,
        trace: (refs) => {
          asked.push(...refs.map((item) => item.id))
          return Effect.succeed(new Map())
        },
        cacheFile: file,
        now: NOV_24 + 1,
      }),
    )
    expect(asked).toEqual(["ses_twoA", "ses_twoB"])
  })

  test("reads Claude Code subagents from their transcripts without the OpenCode trace", async () => {
    const file = await cacheFile()
    const config = path.dirname(file)
    const directory = path.join(config, "Brain")
    const folder = path.join(
      config,
      "projects",
      HarnessSubagentTrace.claudeProjectFolder(directory),
      "session",
      "subagents",
    )
    await mkdir(folder, { recursive: true })
    await writeFile(
      path.join(folder, "agent-adee9c9e2d5264059.jsonl"),
      JSON.stringify({ message: { id: "m1", usage: { input_tokens: 7, output_tokens: 3 } } }),
    )
    const result = await Effect.runPromise(
      TokenUsage.traceUnreported({
        rows: [
          {
            session: "c",
            at: NOV_24,
            harness: "claude-code",
            tokens: tokens(1),
            cost: 0,
            subagents: [{ name: "general-purpose", output: "Done. agentId: adee9c9e2d5264059 (internal ID)" }],
          },
        ],
        directories: new Map([["c", directory]]),
        trace: () => Effect.die(new Error("not used")),
        cacheFile: file,
        claudeConfigDir: config,
        now: NOV_24,
      }),
    )
    expect(result[0]?.subagents[0]).toMatchObject({ source: "claude-transcript", usage: tokens(7, 3) })
  })

  test("summaries carry the traced source and drop the raw output", () => {
    const summary = TokenUsage.summarize({
      since: 0,
      offsetMinutes: 0,
      sessions: [{ id: "s", title: "t", directory: "/d" }],
      rows: [
        {
          session: "s",
          at: NOV_24,
          harness: "claude-code",
          tokens: tokens(1),
          cost: 0,
          subagents: [
            { name: "general-purpose", usage: tokens(5), source: "claude-transcript", output: "agentId: a1" },
          ],
        },
      ],
    })
    expect(summary.heaviest[0]?.subagents[0]).toEqual({
      name: "general-purpose",
      total: 5,
      source: "claude-transcript",
    })
    expect(summary.harnesses[0]?.unreported).toBe(0)
    expect(JSON.stringify(summary)).not.toContain("agentId")
  })
})
