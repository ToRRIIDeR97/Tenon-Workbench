import { describe, expect, test } from "bun:test"
import { blankedSecrets, exportSettings, mergeSettings, parseSettingsBackup } from "./backup"

describe("AC-29 backup (verification)", () => {
  test("an empty MCP config exports as an empty object and sections skip missing parts", () => {
    const file = exportSettings({ settings: { appearance: { fontSize: 12 } }, mcp: undefined, now: new Date() })
    expect(file.mcp).toEqual({})
    const parsed = parseSettingsBackup(JSON.stringify(file))
    expect(parsed.ok && parsed.sections).toEqual(["appearance"])
  })

  test("blanked MCP entries are listed by name", () => {
    const file = exportSettings({
      settings: {},
      mcp: {
        a: { type: "remote", url: "https://x", headers: { Authorization: "t" } },
        b: { type: "remote", url: "https://y" },
      },
      now: new Date(),
    })
    expect(blankedSecrets(file)).toEqual(["a"])
  })

  test("a file that is JSON but not an object is rejected, as is one without settings", () => {
    expect(parseSettingsBackup("[]").ok).toBe(false)
    expect(parseSettingsBackup("null").ok).toBe(false)
    expect(parseSettingsBackup(JSON.stringify({ format: "tenon-settings", version: 1 })).ok).toBe(false)
  })

  test("merging with no sections chosen changes nothing, and unknown section names are ignored", () => {
    const current = { appearance: { fontSize: 20 } }
    const backup = exportSettings({ settings: { appearance: { fontSize: 14 } }, mcp: {}, now: new Date() })
    expect(mergeSettings(current, backup, [])).toEqual(current)
    expect(mergeSettings(current, backup, ["nope" as never])).toEqual(current)
  })

  test("a backup's model profiles and harness defaults are their own sections", () => {
    const file = exportSettings({
      settings: { modelProfiles: { a: { id: "a" } }, harnesses: { lastUsed: { harnessID: "codex" } } },
      mcp: {},
      now: new Date(),
    })
    const parsed = parseSettingsBackup(JSON.stringify(file))
    expect(parsed.ok && parsed.sections).toEqual(["harnesses", "modelProfiles"])
  })
})
