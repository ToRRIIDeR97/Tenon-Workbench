import { describe, expect, test } from "bun:test"
import type { HarnessSyncPresets, HarnessSyncStatus } from "@/harness-sync/types"
import {
  headline,
  instructionsChanged,
  presetFromFile,
  renderPreset,
  shareable,
  sharedUsers,
  skillsChanged,
  withInstructions,
  withSkills,
} from "./harness-sync-model"

const status = (patch: Partial<HarnessSyncStatus> = {}): HarnessSyncStatus => ({
  deviceName: "desk",
  syncFile: { path: "/drive/harness-sync.json", name: "harness-sync.json", conflictCopies: [] },
  document: {
    revision: 3,
    updatedAt: "2026-11-15T10:00:00Z",
    updatedBy: "laptop",
    shared: "S",
    tools: {},
    sharedSkills: [],
  },
  tools: [
    {
      id: "claude",
      name: "Claude Code",
      installed: true,
      path: "",
      exists: true,
      lines: 1,
      mode: "shared",
      state: "inSync",
      editedOutside: false,
    },
    {
      id: "codex",
      name: "Codex",
      installed: true,
      path: "",
      exists: true,
      lines: 1,
      mode: "shared",
      state: "inSync",
      editedOutside: false,
    },
    {
      id: "antigravity",
      name: "Antigravity",
      installed: false,
      path: "",
      exists: false,
      lines: 0,
      mode: "shared",
      state: "notInstalled",
      editedOutside: false,
    },
  ],
  skills: { library: [], tools: [] },
  ...patch,
})

describe("harness sync model", () => {
  test("renders presets like the main process", () => {
    expect(renderPreset("Rules", { mode: "shared", text: "" })).toBe("Rules\n")
    expect(renderPreset("Rules\n", { mode: "append", text: "Extra" })).toBe("Rules\n\nExtra\n")
    expect(renderPreset("Rules", { mode: "append", text: " " })).toBe("Rules\n")
    expect(renderPreset("Rules", { mode: "custom", text: "Own" })).toBe("Own\n")
    expect(renderPreset("Rules", { mode: "off", text: "" })).toBeUndefined()
  })

  test("reads a file as shared, shared + extra, or own", () => {
    expect(presetFromFile("Rules\n", "Rules\n")).toEqual({ mode: "shared", text: "" })
    expect(presetFromFile("Rules", "Rules\n\nMine\n")).toEqual({ mode: "append", text: "Mine\n" })
    expect(presetFromFile("Rules", "Other\n")).toEqual({ mode: "custom", text: "Other\n" })
  })

  test("each tab saves only its own part", () => {
    const saved: HarnessSyncPresets = {
      shared: "S",
      tools: { claude: { mode: "append", text: "c", skillMode: "custom", skillExtras: ["x"] } },
      sharedSkills: ["a"],
      skillSources: {},
    }
    const draft: HarnessSyncPresets = {
      shared: "S2",
      tools: { claude: { mode: "off", text: "", skillMode: "off" }, codex: { mode: "custom", text: "o" } },
      sharedSkills: ["a", "b"],
      skillSources: { b: "codex" },
    }
    expect(instructionsChanged(saved, draft)).toBe(true)
    expect(skillsChanged(saved, draft)).toBe(true)
    expect(withInstructions(saved, draft)).toEqual({
      shared: "S2",
      tools: {
        claude: { mode: "off", text: "", skillMode: "custom", skillExtras: ["x"] },
        codex: { mode: "custom", text: "o" },
      },
      sharedSkills: ["a"],
      skillSources: {},
    })
    expect(withSkills(saved, draft)).toEqual({
      shared: "S",
      tools: { claude: { mode: "append", text: "c", skillMode: "off" }, codex: { mode: "shared", text: "" } },
      sharedSkills: ["a", "b"],
      skillSources: { b: "codex" },
    })
    expect(instructionsChanged(saved, structuredClone(saved))).toBe(false)
  })

  test("headline names what needs attention first", () => {
    expect(headline(status({ syncFile: undefined })).key).toBe("setup")
    expect(headline(status({ error: "bad" }))).toEqual({ tone: "error", key: "unreadable", detail: "bad" })
    const edited = status()
    edited.tools[1] = { ...edited.tools[1], editedOutside: true, state: "differs" }
    expect(headline(edited)).toEqual({ tone: "warn", key: "outside", names: ["Codex"] })
    expect(headline(status())).toMatchObject({ tone: "ok", key: "synced", by: "laptop" })
  })

  test("lists shared users and shareable skills once", () => {
    const draft: HarnessSyncPresets = {
      shared: "S",
      tools: { codex: { mode: "custom", text: "" } },
      sharedSkills: ["a"],
      skillSources: {},
    }
    expect(sharedUsers(status(), draft)).toEqual(["Claude Code"])
    const local = (name: string) => ({
      name,
      description: "",
      files: 1,
      wanted: false,
      state: "local" as const,
      editedOutside: false,
      autoUpload: false,
    })
    const withSkills = status({
      skills: {
        library: [],
        tools: [
          { tool: "claude", folder: "", skills: [local("b"), local("a")] },
          { tool: "codex", folder: "", skills: [local("b")] },
        ],
      },
    })
    expect(shareable(withSkills, draft).map((skill) => [skill.name, skill.tool])).toEqual([["b", "claude"]])
  })
})
