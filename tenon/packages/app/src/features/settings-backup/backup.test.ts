import { describe, expect, test } from "bun:test"
import { exportSettings, mergeSettings, parseSettingsBackup } from "./backup"

const settings = {
  general: { autoSave: true },
  appearance: { fontSize: 14 },
  keybinds: { "find.open": "mod+f" },
  notifications: { agent: true, permissions: true, errors: false },
  sounds: { agentEnabled: true },
  calendar: { autoSync: false },
}
const mcp = {
  github: {
    type: "remote",
    url: "https://api.githubcopilot.com/mcp/",
    headers: { Authorization: "Bearer secret" },
    enabled: true,
  },
  local: { type: "local", command: ["npx", "x"], environment: { API_KEY: "secret" }, enabled: true },
}

describe("AC-29 exportSettings", () => {
  test("writes a versioned file with MCP secrets blanked", () => {
    const file = exportSettings({ settings, mcp, now: new Date("2026-11-28T10:00:00.000Z") })
    expect(file.format).toBe("tenon-settings")
    expect(file.version).toBe(1)
    expect(file.exportedAt).toBe("2026-11-28T10:00:00.000Z")
    expect(file.settings).toEqual(settings)
    expect(file.mcp.github).toMatchObject({ headers: { Authorization: "" } })
    expect(file.mcp.local).toMatchObject({ environment: { API_KEY: "" }, command: ["npx", "x"] })
    expect(JSON.stringify(file)).not.toContain("secret")
  })
})

describe("AC-29 parseSettingsBackup", () => {
  test("reads an exported file back", () => {
    const text = JSON.stringify(exportSettings({ settings, mcp, now: new Date() }))
    const parsed = parseSettingsBackup(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok)
      expect(parsed.sections).toEqual([
        "general",
        "appearance",
        "keybinds",
        "notifications",
        "sounds",
        "calendar",
        "mcp",
      ])
  })

  test("rejects other files", () => {
    expect(parseSettingsBackup("not json").ok).toBe(false)
    expect(parseSettingsBackup(JSON.stringify({ format: "other", version: 1 })).ok).toBe(false)
    expect(
      parseSettingsBackup(JSON.stringify({ format: "tenon-settings", version: 2, settings: {}, mcp: {} })).ok,
    ).toBe(false)
  })
})

describe("AC-29 mergeSettings", () => {
  test("replaces only the chosen sections", () => {
    const current = { ...settings, appearance: { fontSize: 20 }, keybinds: { other: "mod+o" } }
    const backup = exportSettings({ settings, mcp, now: new Date() })
    expect(mergeSettings(current, backup, ["appearance"])).toEqual({ ...current, appearance: { fontSize: 14 } })
  })
})
