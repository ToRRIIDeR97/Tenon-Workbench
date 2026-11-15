import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { HarnessSyncToolID, HarnessSyncToolPreset } from "@tenon/app/harness-sync/types"
import { applyInstructions, capture } from "./apply"
import {
  conflictCopies,
  create,
  load,
  parse,
  parsePresets,
  readHash,
  render,
  save,
  serialize,
  skillSet,
  type SyncDocument,
} from "./document"
import { readText, writeAtomic } from "./fsutil"
import { type Skill, backUpSkill, readSkill, skillDescription, validateSkill } from "./skill-files"
import { applySkills, outsideEdits } from "./skills"
import { emptyState, loadState } from "./state"
import { type Locations, configDir, instructionsFile, locationsFromEnv, sandboxedLocations, skillsDir } from "./tools"

const roots: string[] = []
const temp = async (label: string) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), `tenon-harness-sync-${label}-`))
  roots.push(dir)
  return dir
}
afterAll(() => Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true }))))

const machine = async (label: string, installed: HarnessSyncToolID[]) => {
  const locations = sandboxedLocations(path.join(await temp(label), "home"))
  await Promise.all(installed.map((id) => mkdir(configDir(locations, id), { recursive: true })))
  return { locations, state: emptyState() }
}
const drive = async (label: string) => path.join(await temp(label), "harness-sync.json")
const skill = (files: Record<string, string>): Skill => ({ files })
const presets = (
  shared: string,
  tools: Partial<Record<HarnessSyncToolID, HarnessSyncToolPreset>> = {},
  sharedSkills: string[] = [],
) => ({
  shared,
  tools,
  sharedSkills,
})
const read = (m: { locations: Locations }, id: HarnessSyncToolID) => readText(instructionsFile(m.locations, id))
const stateOf = (statuses: { id: string; state: string }[], id: string) => statuses.find((s) => s.id === id)?.state

describe("tools", () => {
  test("paths on macOS and Windows, with overrides", () => {
    const mac = sandboxedLocations("/Users/u", false)
    expect(instructionsFile(mac, "codex")).toBe("/Users/u/.codex/AGENTS.md")
    expect(instructionsFile(mac, "claude")).toBe("/Users/u/.claude/CLAUDE.md")
    expect(instructionsFile(mac, "opencode")).toBe("/Users/u/.config/opencode/AGENTS.md")
    expect(instructionsFile(mac, "tenon")).toBe("/Users/u/.config/tenon-workbench/AGENTS.md")
    expect(instructionsFile(mac, "antigravity")).toBe("/Users/u/.gemini/GEMINI.md")
    expect(instructionsFile(mac, "command-code")).toBe("/Users/u/.commandcode/AGENTS.md")
    expect(skillsDir(mac, "antigravity")).toBe("/Users/u/.gemini/antigravity/skills")
    expect(skillsDir(mac, "tenon")).toBe("/Users/u/.config/tenon-workbench/skills")

    const win = sandboxedLocations("C:\\Users\\u", true)
    expect(instructionsFile(win, "claude")).toBe("C:\\Users\\u\\.claude\\CLAUDE.md")
    expect(skillsDir(win, "opencode")).toBe("C:\\Users\\u\\.config\\opencode\\skills")

    const env = locationsFromEnv(
      "C:\\Users\\u",
      { CODEX_HOME: "D:\\codex", CLAUDE_CONFIG_DIR: "relative", Path: "C:\\bin" },
      true,
    )
    expect(instructionsFile(env, "codex")).toBe("D:\\codex\\AGENTS.md")
    // A relative override is ignored.
    expect(instructionsFile(env, "claude")).toBe("C:\\Users\\u\\.claude\\CLAUDE.md")
    expect(env.pathEnv).toBe("C:\\bin")
    const xdg = locationsFromEnv("/home/u", { XDG_CONFIG_HOME: "/xdg" }, false)
    expect(instructionsFile(xdg, "opencode")).toBe("/xdg/opencode/AGENTS.md")
  })
})

describe("files", () => {
  test("atomic write replaces content and leaves no temp file", async () => {
    const file = path.join(await temp("atomic"), "nested", "file.md")
    await writeAtomic(file, "one")
    await writeAtomic(file, "two")
    expect(await readText(file)).toBe("two")
    expect(await readdir(path.dirname(file))).toEqual(["file.md"])
  })

  test("unreadable state is moved aside and reported", async () => {
    const dir = await temp("state")
    const file = path.join(dir, "state.json")
    expect((await loadState(file)).warning).toBeUndefined()
    await writeFile(file, "{ not json")
    const loaded = await loadState(file)
    expect(loaded.state.syncFile).toBeUndefined()
    const moved = await readdir(dir)
    expect(moved).toHaveLength(1)
    expect(moved[0]).toStartWith("state.json.unreadable-")
    expect(loaded.warning).toContain(moved[0])
    expect(await readFile(path.join(dir, moved[0]), "utf8")).toBe("{ not json")
  })
})

describe("sync file", () => {
  const base = (): SyncDocument => ({
    version: 5,
    revision: 1,
    updatedAt: "",
    updatedBy: "",
    shared: "Shared rules\n",
    tools: {},
    sharedSkills: [],
    skills: {},
  })

  test("renders each mode", () => {
    const doc = base()
    doc.tools.claude = { mode: "append", text: "Claude extra" }
    doc.tools.antigravity = { mode: "custom", text: "Gemini only" }
    doc.tools["command-code"] = { mode: "off", text: "" }
    expect(render(doc, "codex")).toBe("Shared rules\n")
    expect(render(doc, "claude")).toBe("Shared rules\n\nClaude extra\n")
    expect(render(doc, "antigravity")).toBe("Gemini only\n")
    expect(render(doc, "command-code")).toBeUndefined()
  })

  test("skill sets follow modes", () => {
    const doc = base()
    doc.skills = { a: skill({ "SKILL.md": "a" }), b: skill({ "SKILL.md": "b" }), c: skill({ "SKILL.md": "c" }) }
    doc.sharedSkills = ["a", "gone"]
    doc.tools.claude = { mode: "shared", text: "", skillMode: "append", skillExtras: ["b"] }
    doc.tools.opencode = { mode: "shared", text: "", skillMode: "custom", skillExtras: ["b"] }
    doc.tools.antigravity = { mode: "shared", text: "", skillMode: "off" }
    const names = (id: HarnessSyncToolID) => {
      const set = skillSet(doc, id)
      return set ? [...set.keys()] : undefined
    }
    expect(names("codex")).toEqual(["a"])
    expect(names("claude")).toEqual(["a", "b"])
    expect(names("opencode")).toEqual(["b"])
    expect(names("antigravity")).toBeUndefined()
  })

  test("save round trip, skill library and stale revision", async () => {
    const file = await drive("doc")
    const created = await create(file, "Hello", "desk")
    expect(created.revision).toBe(1)
    await expect(create(file, "Again", "desk")).rejects.toThrow()

    const saved = await save(
      file,
      1,
      presets("Hi", { antigravity: { mode: "custom", text: "G" }, codex: { mode: "shared", text: "" } }),
      {},
      "laptop",
    )
    expect(saved.revision).toBe(2)
    expect(saved.updatedBy).toBe("laptop")
    // Default presets are not stored.
    expect(saved.tools.codex).toBeUndefined()
    expect((await load(file)).document).toEqual(saved)
    expect(await readHash(file)).toBe((await load(file)).hash)
    await expect(readHash(path.join(path.dirname(file), "missing.json"))).rejects.toThrow("not found")

    // Sharing a skill needs its content; uploads provide it.
    const shared = presets("Hi", {}, ["greet", "greet"])
    await expect(save(file, 2, shared, {}, "laptop")).rejects.toThrow("greet")
    const withSkill = await save(
      file,
      2,
      shared,
      { greet: skill({ "SKILL.md": "hi" }), unused: skill({ "SKILL.md": "x" }) },
      "laptop",
    )
    expect(withSkill.sharedSkills).toEqual(["greet"])
    expect(Object.keys(withSkill.skills)).toEqual(["greet"])
    // Later saves keep library content without re-uploading.
    expect((await save(file, 3, shared, {}, "laptop")).skills.greet).toEqual(skill({ "SKILL.md": "hi" }))
    expect((await save(file, 4, presets("Hi"), {}, "laptop")).skills).toEqual({})

    const before = await readFile(file)
    await expect(save(file, 1, presets("Lost"), {}, "desk")).rejects.toThrow("laptop")
    expect(await readFile(file)).toEqual(before)
  })

  test("Tenon's preset lives under a top-level key the standalone app ignores", async () => {
    const file = await drive("tenon-key")
    await create(file, "Rules", "desk")
    await save(
      file,
      1,
      presets("Rules", { tenon: { mode: "append", text: "Tenon extra" }, claude: { mode: "off", text: "" } }),
      {},
      "desk",
    )
    const raw = JSON.parse(await readFile(file, "utf8"))
    expect(Object.keys(raw.tools)).toEqual(["claude"])
    expect(raw.tenon).toEqual({ mode: "append", text: "Tenon extra" })
    const doc = (await load(file)).document
    expect(render(doc, "tenon")).toBe("Rules\n\nTenon extra\n")
    // A standalone save drops the key, and Tenon falls back to the shared preset.
    delete raw.tenon
    expect(render(parse(JSON.stringify(raw)), "tenon")).toBe("Rules\n")
  })

  test("writes the same layout as the standalone app", () => {
    const doc = base()
    doc.tools = { codex: { mode: "off", text: "" }, claude: { mode: "custom", text: "c" } }
    doc.skills = { r: skill({ "b.md": "b", "SKILL.md": "s" }) }
    doc.sharedSkills = ["r"]
    const text = serialize(doc)
    expect(text.endsWith("}\n")).toBe(true)
    expect(Object.keys(JSON.parse(text))).toEqual([
      "version",
      "revision",
      "updatedAt",
      "updatedBy",
      "shared",
      "tools",
      "sharedSkills",
      "skills",
    ])
    expect(Object.keys(JSON.parse(text).tools)).toEqual(["claude", "codex"])
    expect(Object.keys(JSON.parse(text).skills.r.files)).toEqual(["SKILL.md", "b.md"])
  })

  test("migrates version 4", () => {
    const doc = parse(
      JSON.stringify({
        version: 4,
        revision: 2,
        updatedAt: "",
        updatedBy: "a",
        shared: "x",
        tools: { codex: { mode: "shared", skills: false }, claude: { mode: "custom", text: "c" } },
        skills: { review: { files: { "SKILL.md": "r" } } },
      }),
    )
    expect(doc.version).toBe(5)
    expect(doc.sharedSkills).toEqual(["review"])
    expect(doc.tools.codex?.skillMode).toBe("off")
    expect(doc.tools.claude?.skillMode).toBeUndefined()
    expect(skillSet(doc, "claude")?.has("review")).toBe(true)
  })

  test("rejects bad files", () => {
    const v = (extra: object) =>
      JSON.stringify({ version: 5, revision: 1, updatedAt: "", updatedBy: "", shared: "", ...extra })
    expect(() => parse("not json")).toThrow()
    expect(() => parse(JSON.stringify({ version: 2, entries: {} }))).toThrow()
    expect(() => parse(JSON.stringify({ version: 6 }))).toThrow("newer")
    expect(() => parse(v({ tools: { vim: { mode: "shared" } } }))).toThrow()
    expect(() => parse(v({ tools: { codex: { mode: "weird" } } }))).toThrow()
    expect(() => parse(v({ tools: { codex: { text: "no mode" } } }))).toThrow()
    expect(() => parse(v({ skills: { "../x": { files: { "SKILL.md": "x" } } } }))).toThrow()
    expect(() => parse(v({ skills: { x: { files: { "SKILL.md": "x", "../../evil": "x" } } } }))).toThrow()
    expect(() => parse(v({ sharedSkills: ["../x"] }))).toThrow()
    const ok = parse(JSON.stringify({ version: 3, revision: 7, updatedAt: "", updatedBy: "a", shared: "x" }))
    expect(ok.tools.codex).toBeUndefined()
    expect(ok.version).toBe(5)
  })

  test("checks presets from the renderer", () => {
    expect(() => parsePresets({ shared: 1 })).toThrow()
    expect(() => parsePresets({ shared: "", tools: { vim: { mode: "shared" } } })).toThrow()
    expect(() => parsePresets({ shared: "", tools: {}, skillSources: { x: "/etc" } })).toThrow()
    expect(
      parsePresets({
        shared: "s",
        tools: { tenon: { mode: "off", text: "" } },
        sharedSkills: ["a"],
        skillSources: { a: "claude" },
      }),
    ).toEqual({
      shared: "s",
      tools: { tenon: { mode: "off", text: "" } },
      sharedSkills: ["a"],
      skillSources: { a: "claude" },
    })
  })

  test("finds Drive conflict copies", async () => {
    const file = await drive("conflict")
    const dir = path.dirname(file)
    await Promise.all(
      ["harness-sync.json", "harness-sync (1).json", "other.json", "harness-sync.json.bak"].map((name) =>
        writeFile(path.join(dir, name), "{}"),
      ),
    )
    expect(await conflictCopies(file)).toEqual(["harness-sync (1).json"])
  })
})

describe("instructions", () => {
  test("two computers get the same presets", async () => {
    const file = await drive("two")
    const desk = await machine("desk", ["codex", "claude", "antigravity", "command-code"])
    await writeFile(instructionsFile(desk.locations, "claude"), "Old claude\n")
    const created = await create(file, "Be concise.", "desk")
    const saved = await save(
      file,
      created.revision,
      presets("Be concise.", {
        antigravity: { mode: "custom", text: "Gemini preset" },
        "command-code": { mode: "off", text: "" },
      }),
      {},
      "desk",
    )
    const statuses = await applyInstructions(saved, desk.locations, desk.state, "always")
    expect(stateOf(statuses, "claude")).toBe("updated")
    expect(stateOf(statuses, "opencode")).toBe("notInstalled")
    expect(stateOf(statuses, "command-code")).toBe("off")
    expect(stateOf(statuses, "tenon")).toBe("updated")
    expect(await read(desk, "claude")).toBe("Be concise.\n")
    expect(await read(desk, "codex")).toBe("Be concise.\n")
    expect(await read(desk, "tenon")).toBe("Be concise.\n")
    expect(await read(desk, "antigravity")).toBe("Gemini preset\n")
    expect(await read(desk, "command-code")).toBeUndefined()
    expect(await read(desk, "opencode")).toBeUndefined()

    const laptop = await machine("laptop", ["antigravity", "codex"])
    const fromDrive = (await load(file)).document
    await applyInstructions(fromDrive, laptop.locations, laptop.state, "always")
    expect(await read(laptop, "antigravity")).toBe("Gemini preset\n")
    expect(await read(laptop, "codex")).toBe("Be concise.\n")
    const again = await applyInstructions(fromDrive, laptop.locations, laptop.state, "always")
    expect(again.every((status) => status.state !== "updated")).toBe(true)
  })

  test("capture makes this computer the source", async () => {
    const file = await drive("capture")
    const created = await create(file, "Desk rules\n", "desk")
    const laptop = await machine("capture-laptop", ["codex", "claude", "opencode", "antigravity"])
    await writeFile(instructionsFile(laptop.locations, "codex"), "Laptop rules\n")
    await writeFile(instructionsFile(laptop.locations, "claude"), "Laptop rules\n\nClaude extra\n")
    await writeFile(instructionsFile(laptop.locations, "antigravity"), "Gemini only\n")

    const captured = await capture(created, laptop.locations, "codex")
    expect(captured.shared).toBe("Laptop rules\n")
    expect(captured.tools.claude).toEqual({ mode: "append", text: "Claude extra\n" })
    expect(captured.tools.antigravity).toEqual({ mode: "custom", text: "Gemini only\n" })
    // OpenCode has no file yet, so it keeps the shared preset.
    expect(captured.tools.opencode).toEqual({ mode: "shared", text: "" })

    const saved = await save(file, created.revision, captured, {}, "laptop")
    const statuses = await applyInstructions(saved, laptop.locations, laptop.state, "always")
    expect(stateOf(statuses, "codex")).toBe("inSync")
    expect(stateOf(statuses, "claude")).toBe("inSync")
    expect(stateOf(statuses, "antigravity")).toBe("inSync")
    expect(await read(laptop, "opencode")).toBe("Laptop rules\n")
    await expect(capture(saved, laptop.locations, "command-code")).rejects.toThrow()
  })

  test("checking reports outside edits without writing", async () => {
    const desk = await machine("outside", ["codex"])
    const doc = await create(await drive("outside"), "Rules", "desk")
    await applyInstructions(doc, desk.locations, desk.state, "always")
    await writeFile(instructionsFile(desk.locations, "codex"), "Rules\nmy edit\n")
    const codex = (await applyInstructions(doc, desk.locations, desk.state, "never")).find((s) => s.id === "codex")
    expect(codex?.state).toBe("differs")
    expect(codex?.editedOutside).toBe(true)
    expect(codex?.lines).toBe(2)
    expect(await read(desk, "codex")).toBe("Rules\nmy edit\n")
  })

  test("automatic apply keeps outside edits; Sync now replaces them", async () => {
    const desk = await machine("keep", ["codex", "claude"])
    const file = await drive("keep")
    const doc = await create(file, "Rules", "desk")
    await applyInstructions(doc, desk.locations, desk.state, "always")
    await writeFile(instructionsFile(desk.locations, "codex"), "my edit\n")
    const newer = await save(file, doc.revision, presets("New rules"), {}, "laptop")
    const auto = await applyInstructions(newer, desk.locations, desk.state, "keepOutsideEdits")
    const codex = auto.find((s) => s.id === "codex")
    expect([codex?.state, codex?.editedOutside]).toEqual(["differs", true])
    expect(await read(desk, "codex")).toBe("my edit\n")
    expect(stateOf(auto, "claude")).toBe("updated")
    const explicit = await applyInstructions(newer, desk.locations, desk.state, "always")
    expect(stateOf(explicit, "codex")).toBe("updated")
    expect(await read(desk, "codex")).toBe("New rules\n")
  })

  test("empty presets and symlinks are left alone", async () => {
    const desk = await machine("empty", ["codex", "claude"])
    await writeFile(instructionsFile(desk.locations, "codex"), "Keep me\n")
    const file = await drive("empty")
    const statuses = await applyInstructions(await create(file, "", "desk"), desk.locations, desk.state, "always")
    expect(stateOf(statuses, "codex")).toBe("skipped")
    expect(await read(desk, "codex")).toBe("Keep me\n")
    if (process.platform === "win32") return
    const target = path.join(desk.locations.home, "dotfiles.md")
    await writeFile(target, "linked")
    await symlink(target, instructionsFile(desk.locations, "claude"))
    const doc = await create(path.join(path.dirname(file), "b.json"), "x", "d")
    expect(stateOf(await applyInstructions(doc, desk.locations, desk.state, "always"), "claude")).toBe("error")
    expect(await readFile(target, "utf8")).toBe("linked")
  })
})

describe("skills", () => {
  const share = (
    file: string,
    revision: number,
    names: string[],
    uploads: Record<string, Skill>,
    tools: Partial<Record<HarnessSyncToolID, HarnessSyncToolPreset>> = {},
  ) => save(file, revision, presets("Rules", tools, names), uploads, "desk")
  const find = (report: Awaited<ReturnType<typeof applySkills>>, tool: string, name: string) =>
    report.tools.find((entry) => entry.tool === tool)?.skills.find((entry) => entry.name === name)
  const write = async (file: string, text: string) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text)
  }

  test("validates names and paths", () => {
    const ok = skill({ "SKILL.md": "x", "scripts/run.py": "print()" })
    expect(() => validateSkill("my-skill", ok)).not.toThrow()
    for (const name of ["../up", ".hidden", "a/b"]) expect(() => validateSkill(name, ok)).toThrow()
    expect(() => validateSkill("x", skill({ "README.md": "x" }))).toThrow()
    for (const bad of ["../x", "/abs", "a//b", "a\\b", "C:x", ".git/config"])
      expect(() => validateSkill("x", skill({ "SKILL.md": "x", [bad]: "x" }))).toThrow()
    expect(skillDescription(skill({ "SKILL.md": '---\nname: x\ndescription: "Does things"\n---\nBody' }))).toBe(
      "Does things",
    )
  })

  test("shares, syncs and unshares a skill across two computers", async () => {
    const file = await drive("skills")
    const desk = await machine("skills-desk", ["claude", "codex"])
    const source = path.join(skillsDir(desk.locations, "claude"), "review")
    await write(path.join(source, "SKILL.md"), "---\ndescription: Reviews code\n---\n")
    await write(path.join(source, "scripts", "check.sh"), "echo ok\n")
    await write(path.join(source, ".DS_Store"), "junk")
    await write(path.join(source, "scripts", "__pycache__", "check.cpython-314.pyc"), "\xa7\x0d")
    await write(path.join(source, "stray.pyc"), "x")

    const created = await create(file, "Rules", "desk")
    const listed = await applySkills(created, desk.locations, desk.state, "never")
    expect(find(listed, "claude", "review")).toMatchObject({
      state: "local",
      wanted: false,
      description: "Reviews code",
    })
    expect(listed.library).toEqual([])

    const local = (await readSkill(source))!
    expect(Object.keys(local.files)).toHaveLength(2)
    const saved = await share(file, created.revision, ["review"], { review: local })
    const report = await applySkills(saved, desk.locations, desk.state, "always")
    expect(report.library).toHaveLength(1)
    expect(find(report, "claude", "review")?.state).toBe("inSync")
    expect(find(report, "codex", "review")?.state).toBe("updated")
    expect(find(report, "tenon", "review")?.state).toBe("updated")
    expect(await readSkill(path.join(skillsDir(desk.locations, "codex"), "review"))).toEqual(local)

    // Another computer receives it; its own skill with another name is untouched.
    const laptop = await machine("skills-laptop", ["opencode"])
    const mine = path.join(skillsDir(laptop.locations, "opencode"), "mine")
    await write(path.join(mine, "SKILL.md"), "mine")
    const fromDrive = (await load(file)).document
    await applySkills(fromDrive, laptop.locations, laptop.state, "always")
    const target = path.join(skillsDir(laptop.locations, "opencode"), "review")
    expect(await readSkill(target)).toEqual(local)

    // An outside edit is reported, then replaced, including extra files.
    await writeFile(path.join(target, "extra.md"), "extra")
    const checked = find(await applySkills(fromDrive, laptop.locations, laptop.state, "never"), "opencode", "review")
    expect([checked?.state, checked?.editedOutside]).toEqual(["differs", true])
    await applySkills(fromDrive, laptop.locations, laptop.state, "always")
    expect(await readText(path.join(target, "extra.md"))).toBeUndefined()

    // Unsharing deletes unchanged copies Tenon wrote, keeps edited ones and the original.
    await writeFile(path.join(skillsDir(desk.locations, "codex"), "review", "SKILL.md"), "edited")
    const removed = await share(file, saved.revision, [], {})
    await applySkills(removed, laptop.locations, laptop.state, "always")
    const after = await applySkills(removed, desk.locations, desk.state, "always")
    expect(await readSkill(target)).toBeUndefined()
    expect(await readText(path.join(source, "SKILL.md"))).toBeDefined()
    expect(find(after, "claude", "review")?.state).toBe("local")
    expect(await readText(path.join(skillsDir(desk.locations, "codex"), "review", "SKILL.md"))).toBe("edited")
    expect(await readText(path.join(mine, "SKILL.md"))).toBe("mine")
    expect(desk.state.appliedSkills).toEqual({})
    expect(desk.state.writtenSkills).toEqual([])
  })

  test("automatic apply keeps edited skills", async () => {
    const file = await drive("skills-keep")
    const desk = await machine("skills-keep-desk", ["claude", "codex"])
    const created = await create(file, "Rules", "desk")
    const saved = await share(file, created.revision, ["tip"], { tip: skill({ "SKILL.md": "tip" }) })
    await applySkills(saved, desk.locations, desk.state, "always")
    const edited = path.join(skillsDir(desk.locations, "codex"), "tip", "SKILL.md")
    await writeFile(edited, "mine")
    const newer = await share(file, saved.revision, ["tip"], { tip: skill({ "SKILL.md": "tip v2" }) })
    const auto = await applySkills(newer, desk.locations, desk.state, "keepOutsideEdits")
    expect(find(auto, "codex", "tip")).toMatchObject({ state: "differs", editedOutside: true })
    expect(await readText(edited)).toBe("mine")
    expect(find(auto, "claude", "tip")?.state).toBe("updated")
    expect(find(await applySkills(newer, desk.locations, desk.state, "always"), "codex", "tip")?.state).toBe("updated")
    expect(await readText(edited)).toBe("tip v2")
  })

  test("replaced copies Tenon did not write are backed up", async () => {
    const file = await drive("skills-backup")
    const backups = path.join(await temp("skills-backup-data"), "backups")
    const desk = await machine("skills-backup-desk", ["claude", "codex"])
    const codex = path.join(skillsDir(desk.locations, "codex"), "tip")
    await write(path.join(codex, "SKILL.md"), "codex original")
    const created = await create(file, "Rules", "desk")
    const saved = await share(file, created.revision, ["tip"], { tip: skill({ "SKILL.md": "tip" }) })

    const first = await applySkills(saved, desk.locations, desk.state, "always", backups)
    const replaced = find(first, "codex", "tip")
    expect(replaced?.state).toBe("updated")
    expect(replaced?.backup).toStartWith(path.join(backups, "codex", "tip"))
    expect(await readText(path.join(replaced!.backup!, "SKILL.md"))).toBe("codex original")
    expect(find(first, "claude", "tip")?.backup).toBeUndefined()

    await writeFile(path.join(codex, "SKILL.md"), "mine")
    await write(path.join(codex, "scripts", "run.py"), "print()")
    const second = find(await applySkills(saved, desk.locations, desk.state, "always", backups), "codex", "tip")
    expect(await readText(path.join(second!.backup!, "SKILL.md"))).toBe("mine")
    expect(await readText(path.join(second!.backup!, "scripts", "run.py"))).toBe("print()")
    expect(await readText(path.join(codex, "SKILL.md"))).toBe("tip")
    expect(await readdir(codex)).toEqual(["SKILL.md"])

    const newer = await share(file, saved.revision, ["tip"], { tip: skill({ "SKILL.md": "tip v2" }) })
    const third = find(await applySkills(newer, desk.locations, desk.state, "always", backups), "codex", "tip")
    expect(third?.state).toBe("updated")
    expect(third?.backup).toBeUndefined()

    for (const round of [0, 1, 2, 3, 4, 5, 6])
      await backUpSkill(backups, "codex", "tip", skill({ "SKILL.md": String(round) }))
    const left = (await readdir(path.join(backups, "codex", "tip"))).toSorted()
    expect(left).toHaveLength(5)
    expect(await readText(path.join(backups, "codex", "tip", left.at(-1)!, "SKILL.md"))).toBe("6")
  })

  test("finds outside edits that are safe to upload", async () => {
    const file = await drive("skills-upload")
    const desk = await machine("skills-upload-desk", ["claude", "codex"])
    const created = await create(file, "Rules", "desk")
    const tenonOff = { tenon: { mode: "shared" as const, text: "", skillMode: "off" as const } }
    const tip = (text: string) => ({ tip: skill({ "SKILL.md": text }) })
    const saved = await share(file, created.revision, ["tip"], tip("tip"), tenonOff)
    const claude = path.join(skillsDir(desk.locations, "claude"), "tip", "SKILL.md")
    await write(claude, "older local")
    expect(await outsideEdits(saved, desk.locations, desk.state)).toEqual({})

    await applySkills(saved, desk.locations, desk.state, "always")
    expect(await outsideEdits(saved, desk.locations, desk.state)).toEqual({})

    const codex = path.join(skillsDir(desk.locations, "codex"), "tip", "SKILL.md")
    await writeFile(codex, "mine")
    expect(
      find(await applySkills(saved, desk.locations, desk.state, "keepOutsideEdits"), "codex", "tip")?.autoUpload,
    ).toBe(true)
    expect(await outsideEdits(saved, desk.locations, desk.state)).toEqual(tip("mine"))

    await writeFile(claude, "theirs")
    expect(await outsideEdits(saved, desk.locations, desk.state)).toEqual({})
    await writeFile(claude, "mine")
    expect(await outsideEdits(saved, desk.locations, desk.state)).toEqual(tip("mine"))

    await writeFile(claude, "tip")
    await writeFile(codex, "bad\0")
    expect(await outsideEdits(saved, desk.locations, desk.state)).toEqual({})

    await writeFile(codex, "mine")
    const newer = await share(file, saved.revision, ["tip"], tip("tip v2"), tenonOff)
    expect(await outsideEdits(newer, desk.locations, desk.state)).toEqual({})
    expect(
      find(await applySkills(newer, desk.locations, desk.state, "keepOutsideEdits"), "codex", "tip")?.autoUpload,
    ).toBe(false)
    expect(await readText(codex)).toBe("mine")
  })

  test("tool modes pick skills, and symlinked copies are refused", async () => {
    const file = await drive("skills-modes")
    const desk = await machine("skills-modes-desk", ["claude", "codex", "opencode"])
    const created = await create(file, "Rules", "desk")
    const saved = await share(
      file,
      created.revision,
      ["base"],
      { base: skill({ "SKILL.md": "base" }), extra: skill({ "SKILL.md": "extra" }) },
      {
        claude: { mode: "shared", text: "", skillMode: "append", skillExtras: ["extra"] },
        opencode: { mode: "shared", text: "", skillMode: "custom", skillExtras: ["extra"] },
        codex: { mode: "shared", text: "", skillMode: "off" },
      },
    )
    if (process.platform !== "win32") {
      const elsewhere = path.join(desk.locations.home, "elsewhere")
      await mkdir(elsewhere, { recursive: true })
      await mkdir(skillsDir(desk.locations, "tenon"), { recursive: true })
      await symlink(elsewhere, path.join(skillsDir(desk.locations, "tenon"), "base"))
    }
    const report = await applySkills(saved, desk.locations, desk.state, "always")
    expect(find(report, "claude", "base")?.state).toBe("updated")
    expect(find(report, "claude", "extra")?.state).toBe("updated")
    expect(find(report, "opencode", "base")).toBeUndefined()
    expect(find(report, "opencode", "extra")?.state).toBe("updated")
    expect(report.tools.find((tool) => tool.tool === "codex")?.skills).toEqual([])
    expect(await readSkill(path.join(skillsDir(desk.locations, "codex"), "base"))).toBeUndefined()
    if (process.platform === "win32") return
    expect(find(report, "tenon", "base")?.state).toBe("error")
    expect(await readdir(path.join(desk.locations.home, "elsewhere"))).toEqual([])
  })
})
