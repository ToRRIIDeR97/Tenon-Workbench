import { afterAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { load } from "./document"
import { createHarnessSync } from "./service"
import { configDir, sandboxedLocations, skillsDir } from "./tools"

let root = ""
afterAll(() => rm(root, { recursive: true, force: true }))

test("a stable outside edit is uploaded and reaches the other harnesses", async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tenon-harness-sync-service-"))
  const locations = sandboxedLocations(path.join(root, "home"))
  await Promise.all(["claude", "codex"].map((id) => mkdir(configDir(locations, id as "claude"), { recursive: true })))
  const claude = path.join(skillsDir(locations, "claude"), "tip", "SKILL.md")
  const codex = path.join(skillsDir(locations, "codex"), "tip", "SKILL.md")
  await mkdir(path.dirname(claude), { recursive: true })
  await writeFile(claude, "tip")
  const drive = path.join(root, "drive", "harness-sync.json")
  const dataDir = path.join(root, "data")
  const sync = createHarnessSync({
    locations,
    dataDir,
    pickNewFile: async () => drive,
    pickExistingFile: async () => drive,
    changed: () => undefined,
  })
  const read = (file: string) => readFile(file, "utf8")

  const created = await sync.createSyncFile(undefined)
  expect(created?.document?.revision).toBe(1)
  // Renderer input is checked: unknown harnesses and paths are refused.
  await expect(
    sync.save({ shared: "Rules", tools: {}, sharedSkills: ["tip"], skillSources: { tip: "../x" } }, 1),
  ).rejects.toThrow()
  await sync.save({ shared: "Rules", tools: {}, sharedSkills: ["tip"], skillSources: { tip: "claude" } }, 1)
  expect(await read(codex)).toBe("tip")

  // An edit is uploaded only once two checks in a row find the same content.
  const seen = new Map<string, string>()
  await writeFile(claude, "tip, improved")
  expect(await sync.testing.upload(seen)).toBe(false)
  await writeFile(claude, "tip, improved twice")
  expect(await sync.testing.upload(seen)).toBe(false)
  expect((await load(drive)).document.revision).toBe(2)
  expect(await sync.testing.upload(seen)).toBe(true)
  const uploaded = (await load(drive)).document
  expect(uploaded.revision).toBe(3)
  expect(uploaded.skills.tip.files["SKILL.md"]).toBe("tip, improved twice")

  // The automatic apply gives the other harness the edit, and nothing is left flagged.
  const status = await sync.testing.refresh("keepOutsideEdits")
  expect(await read(codex)).toBe("tip, improved twice")
  expect(status.skills.tools.flatMap((tool) => tool.skills).every((skill) => !skill.editedOutside)).toBe(true)
  expect(await sync.testing.upload(seen)).toBe(false)
  const kept = await readdir(path.join(dataDir, "backups", "library", "tip"))
  expect(await read(path.join(dataDir, "backups", "library", "tip", kept[0], "SKILL.md"))).toBe("tip")

  // Sync now uploads a safe edit at once and spreads it.
  await writeFile(codex, "edited in codex")
  await sync.syncNow()
  expect((await load(drive)).document.revision).toBe(4)
  expect(await read(claude)).toBe("edited in codex")

  // Copies edited differently in two harnesses are a conflict: Sync now replaces both, with backups.
  await writeFile(codex, "codex says")
  await writeFile(claude, "claude says")
  const conflict = await sync.syncNow()
  expect((await load(drive)).document.revision).toBe(4)
  expect(await read(codex)).toBe("edited in codex")
  expect(await read(claude)).toBe("edited in codex")
  expect(conflict.skills.tools.flatMap((tool) => tool.skills).filter((skill) => skill.backup)).toHaveLength(2)

  // A stale revision is refused; the device name is validated; disconnect forgets the file.
  await expect(sync.save({ shared: "x", tools: {}, sharedSkills: [], skillSources: {} }, 1)).rejects.toThrow(
    "changed the presets",
  )
  await expect(sync.setDeviceName(" ")).rejects.toThrow()
  expect((await sync.setDeviceName("Desk")).deviceName).toBe("Desk")
  expect((await sync.disconnect()).syncFile).toBeUndefined()
})
