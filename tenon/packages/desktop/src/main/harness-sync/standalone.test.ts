import { afterAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHarnessSync } from "./service"
import { adoptState, standaloneDeviceName, standaloneInstalled, standalonePaths } from "./standalone"
import { configDir, instructionsFile, sandboxedLocations } from "./tools"

const roots: string[] = []
afterAll(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))))
const tempRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tenon-harness-sync-standalone-"))
  roots.push(root)
  return root
}

test("the standalone app's folders follow each platform", () => {
  const windows = standalonePaths(
    "C:\\Users\\a",
    { LOCALAPPDATA: "D:\\Local", ProgramFiles: "C:\\Program Files" },
    "win32",
  )
  expect(windows.dataDir).toBe("D:\\Local\\app.harnesssync.desktop")
  expect(windows.installs).toEqual([
    "D:\\Local\\Harness Sync\\harness-sync.exe",
    "C:\\Program Files\\Harness Sync\\harness-sync.exe",
  ])
  expect(standalonePaths("C:\\Users\\a", { LOCALAPPDATA: "relative" }, "win32").dataDir).toBe(
    "C:\\Users\\a\\AppData\\Local\\app.harnesssync.desktop",
  )
  const mac = standalonePaths("/Users/a", {}, "darwin")
  expect(mac.dataDir).toBe("/Users/a/Library/Application Support/app.harnesssync.desktop")
  expect(mac.installs).toEqual(["/Applications/Harness Sync.app", "/Users/a/Applications/Harness Sync.app"])
})

test("the device name matches the standalone app's rule", () => {
  expect(standaloneDeviceName({ COMPUTERNAME: " DESK ", HOSTNAME: "other" })).toBe("DESK")
  expect(standaloneDeviceName({ HOSTNAME: "mac" })).toBe("mac")
  expect(standaloneDeviceName({})).toBe("This computer")
})

test("Tenon's connection moves into the app's state only when the app has none", async () => {
  const root = await tempRoot()
  const own = path.join(root, "own")
  const app = path.join(root, "app")
  expect(standaloneInstalled({ dataDir: app, installs: [], platform: "linux" })).toBe(false)
  await mkdir(own, { recursive: true })
  await writeFile(
    path.join(own, "state.json"),
    JSON.stringify({
      syncFile: "/drive/a.json",
      deviceName: "Tenon",
      applied: { claude: "h" },
      appliedSkills: {},
      writtenSkills: ["claude/tip"],
    }),
  )
  await mkdir(app, { recursive: true })
  await writeFile(path.join(app, "state.json"), JSON.stringify({ syncFile: null, deviceName: "Desk", applied: {} }))
  expect(standaloneInstalled({ dataDir: app, installs: [], platform: "linux" })).toBe(true)
  await adoptState(own, app)
  const adopted = JSON.parse(await readFile(path.join(app, "state.json"), "utf8"))
  expect(adopted).toMatchObject({ syncFile: "/drive/a.json", deviceName: "Desk", writtenSkills: ["claude/tip"] })

  await writeFile(path.join(own, "state.json"), JSON.stringify({ syncFile: "/drive/b.json", applied: {} }))
  await adoptState(own, app)
  expect(JSON.parse(await readFile(path.join(app, "state.json"), "utf8")).syncFile).toBe("/drive/a.json")
})

test("the background check waits while the app is open and resumes when it closes", async () => {
  const root = await tempRoot()
  const locations = sandboxedLocations(path.join(root, "home"))
  await mkdir(configDir(locations, "claude"), { recursive: true })
  const drive = path.join(root, "drive", "harness-sync.json")
  const dataDir = path.join(root, "app")
  let running = true
  const sync = createHarnessSync({
    locations,
    dataDir,
    pickNewFile: async () => drive,
    pickExistingFile: async () => drive,
    changed: () => undefined,
    follow: { running: async () => running, defaultDeviceName: "DESK" },
  })
  const created = await sync.createSyncFile(undefined)
  expect(created?.deviceName).toBe("DESK")
  const saved = await sync.save({ shared: "Rules", tools: {}, sharedSkills: [], skillSources: {} }, 1)
  expect(await readFile(instructionsFile(locations, "claude"), "utf8")).toBe("Rules\n")

  const file = JSON.parse(await readFile(drive, "utf8"))
  await writeFile(drive, JSON.stringify({ ...file, revision: saved.document!.revision + 1, shared: "From the app" }))
  expect(await sync.testing.check()).toBeUndefined()
  expect((await sync.status()).standalone).toEqual({ running: true })
  expect(await readFile(instructionsFile(locations, "claude"), "utf8")).toBe("Rules\n")

  running = false
  const resumed = await sync.testing.check()
  expect(resumed?.standalone).toEqual({ running: false })
  expect(await readFile(instructionsFile(locations, "claude"), "utf8")).toBe("From the app\n")
})
