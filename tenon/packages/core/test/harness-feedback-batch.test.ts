import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { HarnessSkills } from "@tenon/core/harness/skills"
import { HarnessUsage } from "@tenon/core/harness/usage"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-feedback-"))
afterAll(() => fs.rm(root, { recursive: true, force: true }))

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

// AC-2: a skill installed in two of a harness's folders is listed once, the first one found.
describe("HarnessSkills.scan duplicates", () => {
  test("one entry per name", async () => {
    const home = path.join(root, "home")
    const project = path.join(root, "project")
    await write(path.join(home, ".claude/skills/review/SKILL.md"), "---\nname: review\n---\nA\n")
    await write(path.join(home, ".agents/skills/review/SKILL.md"), "---\nname: review\n---\nB\n")
    await write(path.join(project, ".agents/skills/review/SKILL.md"), "---\nname: review\n---\nC\n")
    const result = await Effect.runPromise(
      HarnessSkills.scan({
        home,
        directory: project,
        harness: { id: "opencode-acp", driver: "acp", command: "opencode" },
      }),
    )
    const reviews = result.skills.filter((item) => item.name === "review")
    expect(reviews).toHaveLength(1)
    expect(reviews[0]!.location).toBe(path.join(home, ".claude/skills/review/SKILL.md"))
  })
})

// AC-11: the key Tenon chats with is the one checked for plan limits.
describe("OpenCode Go key", () => {
  const key = (integrationID: string, value: string) => ({ integrationID, value: { type: "key" as const, key: value } })

  test("prefers an opencode-go key, then an opencode key", () => {
    expect(HarnessUsage.openCodeGoKeyFrom([key("opencode", "zen"), key("opencode-go", "go")])).toBe("go")
    expect(HarnessUsage.openCodeGoKeyFrom([key("openai", "x"), key("opencode", "zen")])).toBe("zen")
    expect(HarnessUsage.openCodeGoKeyFrom([key("openai", "x")])).toBeUndefined()
  })

  test("a stored key is used before auth.json", async () => {
    const data = path.join(root, "data")
    await write(path.join(data, "auth.json"), JSON.stringify({ "opencode-go": { type: "api", key: "old" } }))
    const seen: string[] = []
    const request = (async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("authorization") ?? "")
      return new Response(JSON.stringify({ usage: {} }), { status: 200 })
    }) as unknown as typeof fetch
    await Effect.runPromise(HarnessUsage.openCodeGoUsage(data, request, "fresh"))
    await Effect.runPromise(HarnessUsage.openCodeGoUsage(data, request))
    expect(seen).toEqual(["Bearer fresh", "Bearer old"])
  })
})

// AC-13: a Max/Ultra account's Fable window is listed with the other Claude Code windows. The key name follows
// the per-model pattern of `seven_day_opus`; it is an assumption until checked against a live response.
describe("Claude Code Fable window", () => {
  test("seven_day_fable is read after the Sonnet window", () => {
    const windows = HarnessUsage.parseClaudeUsage({
      five_hour: { utilization: 10, resets_at: null },
      seven_day_sonnet: { utilization: 20, resets_at: null },
      seven_day_fable: { utilization: 30, resets_at: null },
    })
    expect(windows.map((window) => [window.id, window.label, window.usedPercent])).toEqual([
      ["five_hour", "5-hour", 10],
      ["seven_day_sonnet", "Weekly (Sonnet)", 20],
      ["seven_day_fable", "Weekly (Fable)", 30],
    ])
  })
})

// A Codex update can move the CLI; a saved absolute path that no longer exists falls back to `codex` on PATH.
describe("codexCommand", () => {
  test("keeps a path that exists, a bare name, and the default", async () => {
    const { codexCommand } = await import("@tenon/core/harness")
    const real = path.join(root, "codex-real")
    await write(real, "")
    expect(codexCommand(real)).toBe(real)
    expect(codexCommand("codex-beta")).toBe("codex-beta")
    expect(codexCommand(undefined)).toBe("codex")
    expect(codexCommand("  ")).toBe("codex")
  })

  test("a missing absolute path falls back to codex", async () => {
    const { codexCommand } = await import("@tenon/core/harness")
    expect(codexCommand(path.join(root, "moved", "codex"))).toBe("codex")
  })
})
