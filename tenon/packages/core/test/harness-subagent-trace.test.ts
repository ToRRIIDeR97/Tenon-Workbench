import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HarnessSubagentTrace } from "../src/harness/subagent-trace"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const line = (id: string, usage: Record<string, number>) =>
  JSON.stringify({ type: "assistant", message: { id, usage } })

describe("HarnessSubagentTrace.ref", () => {
  test("reads the OpenCode child session from the subagent tag", () => {
    expect(
      HarnessSubagentTrace.ref(
        "opencode-acp",
        '<subagent sessionID="ses_e2c616886ffe3YZsH7XLvG0d0j" state="completed">done</subagent>',
        "/work",
      ),
    ).toEqual({ kind: "opencode-session", id: "ses_e2c616886ffe3YZsH7XLvG0d0j", directory: "/work" })
  })

  test("reads the OpenCode child session of a background subagent", () => {
    expect(
      HarnessSubagentTrace.ref(
        "opencode-acp",
        "The subagent is working in the background (sessionID: ses_e2b62381affenao7tnQIiyqrra). You will be told",
        "/work",
      ),
    ).toEqual({ kind: "opencode-session", id: "ses_e2b62381affenao7tnQIiyqrra", directory: "/work" })
  })

  test("reads the Claude Code agent id from the result footer", () => {
    expect(
      HarnessSubagentTrace.ref("claude-code", "Summary...\nagentId: adee9c9e2d5264059 (internal ID)", "C:\\work"),
    ).toEqual({ kind: "claude-agent", id: "adee9c9e2d5264059", directory: "C:\\work" })
  })

  test("ignores other harnesses, loose session ids and ids that could escape a folder", () => {
    expect(HarnessSubagentTrace.ref("codex", '<subagent sessionID="ses_abc">', "/w")).toBeUndefined()
    expect(HarnessSubagentTrace.ref("opencode-acp", "see ses_abc for details", "/w")).toBeUndefined()
    expect(HarnessSubagentTrace.ref("claude-code", "agentId: ../../etc", "/w")).toBeUndefined()
  })
})

describe("HarnessSubagentTrace.claudeProjectFolder", () => {
  test("matches Claude Code's folder names on both platforms", () => {
    expect(
      HarnessSubagentTrace.claudeProjectFolder(
        path.win32.join("C:\\", "Users", "sense", "OneDrive", "Desktop", "Brain"),
      ),
    ).toBe("C--Users-sense-OneDrive-Desktop-Brain")
    expect(HarnessSubagentTrace.claudeProjectFolder(path.posix.join("/", "Users", "me", "my.app"))).toBe(
      "-Users-me-my-app",
    )
  })

  test("uses CLAUDE_CONFIG_DIR before the home folder", () => {
    expect(HarnessSubagentTrace.claudeConfigDir({ CLAUDE_CONFIG_DIR: "/custom" })).toBe("/custom")
    expect(HarnessSubagentTrace.claudeConfigDir({ HOME: "/home/me" })).toBe(path.join("/home/me", ".claude"))
  })
})

describe("HarnessSubagentTrace.claudeTranscriptUsage", () => {
  test("counts each assistant message once even when it spans several lines", () => {
    const text = [
      line("msg_1", {
        input_tokens: 3,
        output_tokens: 10,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
      }),
      line("msg_1", {
        input_tokens: 3,
        output_tokens: 10,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
      }),
      line("msg_2", { input_tokens: 1, output_tokens: 5, cache_read_input_tokens: 150 }),
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      "not json",
    ].join("\n")
    expect(HarnessSubagentTrace.claudeTranscriptUsage(text)).toEqual({
      inputTokens: 4,
      outputTokens: 15,
      cachedReadTokens: 250,
      cachedWriteTokens: 50,
    })
  })

  test("returns nothing for a transcript without usage", () => {
    expect(HarnessSubagentTrace.claudeTranscriptUsage(JSON.stringify({ type: "user" }))).toBeUndefined()
  })
})

describe("HarnessSubagentTrace.findClaudeTranscript", () => {
  test("finds the agent's transcript under the thread's project folder, then any project", async () => {
    const config = await mkdtemp(path.join(os.tmpdir(), "tenon-claude-"))
    dirs.push(config)
    const directory = path.join(os.tmpdir(), "Brain")
    const own = path.join(config, "projects", HarnessSubagentTrace.claudeProjectFolder(directory), "s1", "subagents")
    const other = path.join(config, "projects", "-elsewhere", "s2", "subagents")
    await mkdir(own, { recursive: true })
    await mkdir(other, { recursive: true })
    await writeFile(path.join(own, "agent-a1111111111111111.jsonl"), line("m", { input_tokens: 1 }))
    await writeFile(path.join(other, "agent-a2222222222222222.jsonl"), line("m", { output_tokens: 2 }))

    expect(
      await HarnessSubagentTrace.findClaudeTranscript({ configDir: config, directory, agentId: "a1111111111111111" }),
    ).toContain('"input_tokens":1')
    expect(
      await HarnessSubagentTrace.findClaudeTranscript({ configDir: config, directory, agentId: "a2222222222222222" }),
    ).toContain('"output_tokens":2')
    expect(
      await HarnessSubagentTrace.findClaudeTranscript({ configDir: config, directory, agentId: "a3333333333333333" }),
    ).toBeUndefined()
    expect(
      await HarnessSubagentTrace.findClaudeTranscript({ configDir: config, directory, agentId: "../s1" }),
    ).toBeUndefined()
  })
})
