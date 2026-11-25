import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { setSkillEnabled } from "@/utils/server"
import { sharedWith, skillSections, switchable } from "./skills-sections"

const sections = skillSections({
  tenon: [{ name: "notes", scope: "global", enabled: true }],
  harnesses: [
    {
      id: "claude-code",
      name: "Claude Code",
      source: "filesystem",
      skills: [
        { name: "pdf", scope: "global", location: "/h/.claude/skills/pdf/SKILL.md", enabled: true, editable: true },
        { name: "etc", scope: "global", location: "/etc/codex/skills/etc/SKILL.md", enabled: true, editable: false },
      ],
    },
    {
      id: "opencode-acp",
      name: "OpenCode",
      source: "filesystem",
      skills: [
        { name: "pdf", scope: "global", location: "/h/.claude/skills/pdf/SKILL.md", enabled: true, editable: true },
      ],
    },
    { id: "gemini", name: "Gemini", source: "reported", skills: [{ name: "review", scope: "global" }] },
  ],
})

describe("AC-8 harness skill rows can be switched", () => {
  test("a harness skill in a folder Tenon can write has a switch; reported and system skills don't", () => {
    const claude = sections.find((item) => item.id === "claude-code")!
    const gemini = sections.find((item) => item.id === "gemini")!
    expect(switchable(claude, claude.skills.find((item) => item.name === "pdf")!)).toBe(true)
    expect(switchable(claude, claude.skills.find((item) => item.name === "etc")!)).toBe(false)
    expect(switchable(gemini, gemini.skills[0]!)).toBe(false)
    expect(switchable(sections[0]!, sections[0]!.skills[0]!)).toBe(true)
  })

  test("a skill file another harness also reads names that harness, since the switch changes both", () => {
    const claude = sections.find((item) => item.id === "claude-code")!
    const shared = sharedWith(sections)
    expect(shared(claude.id, claude.skills.find((item) => item.name === "pdf")!)).toEqual(["OpenCode"])
    expect(shared(claude.id, claude.skills.find((item) => item.name === "etc")!)).toEqual([])
  })

  test("switching a harness skill posts its harness with the name", async () => {
    let request: Request | undefined
    const fetcher = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        request = new Request(input, init)
        return Response.json({
          location: { directory: "/repo", project: { id: "global", directory: "/repo" } },
          data: { name: "pdf", enabled: false },
        })
      },
      { preconnect: globalThis.fetch.preconnect },
    )
    await setSkillEnabled(
      { server: { url: "http://localhost:4096" }, fetch: fetcher },
      "/repo",
      "pdf",
      false,
      "claude-code",
    )
    expect(await request!.json()).toEqual({ name: "pdf", enabled: false, harness: "claude-code" })
  })

  test("the Skills page renders the switch from switchable() and explains the rename", () => {
    const source = readFileSync(join(import.meta.dir, "skills.tsx"), "utf8")
    expect(source).toContain("switchable(")
    expect(source).toContain("secondBrain.skills.harnessOff")
  })
})
