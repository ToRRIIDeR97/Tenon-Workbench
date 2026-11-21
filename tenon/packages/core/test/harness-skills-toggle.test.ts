import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Exit } from "effect"
import { HarnessSkills } from "@tenon/core/harness/skills"

// #323: a harness skill is switched off by renaming its SKILL.md, which every harness looks for by that exact name.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-skills-toggle-"))
const home = path.join(root, "home")
const project = path.join(root, "project")
afterAll(() => fs.rm(root, { recursive: true, force: true }))

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

const claude = { id: "claude-code", driver: "acp", command: "claude-code-acp" }
const body = "---\nname: deploy-staging\ndescription: Deploys to staging\n---\nRun the deploy.\n"
const skillFile = path.join(home, ".claude/skills/deploy-staging/SKILL.md")
await write(skillFile, body)
await write(path.join(home, ".claude/skills/pdf/SKILL.md"), "---\nname: pdf\n---\nBody\n")
await fs.mkdir(project, { recursive: true })

const scan = () => Effect.runPromise(HarnessSkills.scan({ home, directory: project, harness: claude }))
const toggle = (name: string, enabled: boolean) =>
  Effect.runPromiseExit(HarnessSkills.switchSkill({ home, directory: project, harness: claude, name, enabled }))

describe("AC-7 harness skills can be switched off and back", () => {
  test("listed skills in the harness's own folders are editable and on", async () => {
    const result = await scan()
    expect(result.skills.map((item) => [item.name, item.enabled, item.editable])).toEqual([
      ["deploy-staging", true, true],
      ["pdf", true, true],
    ])
  })

  test("switching off renames SKILL.md to SKILL.md.disabled and the skill is listed as off", async () => {
    const exit = await toggle("deploy-staging", false)
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ name: "deploy-staging", enabled: false })
    expect(await fs.readFile(`${skillFile}.disabled`, "utf8")).toBe(body)
    expect(
      await fs.stat(skillFile).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    const skill = (await scan()).skills.find((item) => item.name === "deploy-staging")
    expect(skill?.enabled).toBe(false)
    expect(skill?.location).toBe(`${skillFile}.disabled`)
  })

  test("switching on restores the original file byte for byte", async () => {
    const exit = await toggle("deploy-staging", true)
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ name: "deploy-staging", enabled: true })
    expect(await fs.readFile(skillFile, "utf8")).toBe(body)
    expect((await scan()).skills.find((item) => item.name === "deploy-staging")?.enabled).toBe(true)
  })

  test("switching on never overwrites a SKILL.md that appeared beside the disabled one", async () => {
    await toggle("pdf", false)
    const pdf = path.join(home, ".claude/skills/pdf/SKILL.md")
    await write(pdf, "---\nname: pdf\n---\nA newer copy\n")
    // The live SKILL.md is the copy listed, so the skill is already on: nothing is renamed over it.
    const exit = await toggle("pdf", true)
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ name: "pdf", enabled: true })
    expect(await fs.readFile(pdf, "utf8")).toBe("---\nname: pdf\n---\nA newer copy\n")
    expect(await fs.readFile(`${pdf}.disabled`, "utf8")).toBe("---\nname: pdf\n---\nBody\n")
  })

  test("an unknown skill, or one the harness only reported, can't be switched", async () => {
    expect(Exit.isFailure(await toggle("nope", false))).toBe(true)
    const reported = await Effect.runPromiseExit(
      HarnessSkills.switchSkill({
        home,
        directory: project,
        harness: { id: "gemini", driver: "acp", command: "gemini" },
        name: "anything",
        enabled: false,
      }),
    )
    expect(Exit.isFailure(reported)).toBe(true)
  })
})

describe("AC-7 the renamed path on Windows and macOS", () => {
  test("posix paths", () => {
    expect(HarnessSkills.toggledLocation("/Users/a/.claude/skills/x/SKILL.md", false, path.posix)).toBe(
      "/Users/a/.claude/skills/x/SKILL.md.disabled",
    )
    expect(HarnessSkills.toggledLocation("/Users/a/.claude/skills/x/SKILL.md.disabled", true, path.posix)).toBe(
      "/Users/a/.claude/skills/x/SKILL.md",
    )
  })

  test("win32 paths", () => {
    expect(HarnessSkills.toggledLocation("C:\\Users\\a\\.claude\\skills\\x\\SKILL.md", false, path.win32)).toBe(
      "C:\\Users\\a\\.claude\\skills\\x\\SKILL.md.disabled",
    )
    expect(HarnessSkills.toggledLocation("C:\\Users\\a\\.claude\\skills\\x\\SKILL.md.disabled", true, path.win32)).toBe(
      "C:\\Users\\a\\.claude\\skills\\x\\SKILL.md",
    )
  })

  test("a file already in the asked state keeps its path", () => {
    expect(HarnessSkills.toggledLocation("/s/x/SKILL.md", true, path.posix)).toBe("/s/x/SKILL.md")
    expect(HarnessSkills.toggledLocation("/s/x/SKILL.md.disabled", false, path.posix)).toBe("/s/x/SKILL.md.disabled")
  })
})
