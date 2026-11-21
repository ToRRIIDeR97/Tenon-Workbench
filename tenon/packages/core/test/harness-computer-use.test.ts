import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HarnessComputerUse } from "@tenon/core/harness/computer-use"
import { Harness } from "@tenon/schema/harness"

// #333 (variant B, whole desktop): a Project turns computer use on; its threads then get the Cua Driver MCP server,
// except harnesses that bring their own computer use.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "computer-use-"))
afterAll(() => fs.rm(root, { recursive: true, force: true }))

describe("AC-21 which threads get the Cua Driver", () => {
  test("an ACP harness in a Project with computer use on gets `cua-driver mcp`", () => {
    expect(HarnessComputerUse.serverFor(Harness.InstanceID.make("gemini"), true, "/u/.local/bin/cua-driver")).toEqual({
      name: "computer",
      command: "/u/.local/bin/cua-driver",
      args: ["mcp"],
      env: [],
    })
  })

  test("Codex and Claude Code keep their own computer use and are never given a second one", () => {
    expect(HarnessComputerUse.serverFor(Harness.ClaudeCode, true, "cua-driver")).toBeUndefined()
    expect(HarnessComputerUse.serverFor(Harness.Codex, true, "cua-driver")).toBeUndefined()
  })

  test("nothing is added when the Project has it off or the driver isn't installed", () => {
    expect(HarnessComputerUse.serverFor(Harness.InstanceID.make("gemini"), false, "cua-driver")).toBeUndefined()
    expect(HarnessComputerUse.serverFor(Harness.InstanceID.make("gemini"), true, undefined)).toBeUndefined()
  })
})

describe("AC-21 the per-Project switch", () => {
  test("off by default, on after switching, per folder, and off again", async () => {
    const project = path.join(root, "app")
    expect(await HarnessComputerUse.enabledFor(project, root)).toBe(false)
    await HarnessComputerUse.setEnabled(project, true, root)
    expect(await HarnessComputerUse.enabledFor(project, root)).toBe(true)
    expect(await HarnessComputerUse.enabledFor(path.join(root, "other"), root)).toBe(false)
    // A thread in a subfolder or a worktree kept inside the Project counts as the Project (panel round 1, C11).
    expect(await HarnessComputerUse.enabledFor(path.join(project, "nested"), root)).toBe(true)
    await HarnessComputerUse.setEnabled(project, false, root)
    expect(await HarnessComputerUse.enabledFor(project, root)).toBe(false)
  })

  test("Windows folders match whatever their case or slashes", () => {
    expect(HarnessComputerUse.sameFolder("C:\\Users\\a\\App", "c:/users/a/app/", path.win32)).toBe(true)
    expect(HarnessComputerUse.sameFolder("/Users/a/App", "/Users/a/app", path.posix)).toBe(false)
  })
})

describe("AC-21 the driver's state, as the Project page shows it", () => {
  test("not installed", async () => {
    expect(await HarnessComputerUse.status({ driver: undefined, platform: "darwin", run: async () => "" })).toEqual({
      installed: false,
      permissions: "unknown",
    })
  })

  test("macOS: both grants on, or one missing", async () => {
    const granted = await HarnessComputerUse.status({
      driver: "cua-driver",
      platform: "darwin",
      run: async () => "Accessibility: granted\nScreen Recording: granted\n",
    })
    expect(granted).toEqual({ installed: true, permissions: "granted", grants: { accessibility: true, screen: true } })
    const missing = await HarnessComputerUse.status({
      driver: "cua-driver",
      platform: "darwin",
      run: async () => "Accessibility: granted\nScreen & System Audio Recording: not granted\n",
    })
    expect(missing.permissions).toBe("missing")
  })

  test("Windows needs no grants", async () => {
    expect(
      await HarnessComputerUse.status({ driver: "C:\\cua\\cua-driver.exe", platform: "win32", run: async () => "" }),
    ).toEqual({ installed: true, permissions: "granted" })
  })
})
