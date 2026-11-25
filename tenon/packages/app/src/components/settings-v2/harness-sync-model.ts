import type {
  HarnessSyncDocumentView,
  HarnessSyncMode,
  HarnessSyncPresets,
  HarnessSyncStatus,
  HarnessSyncToolID,
  HarnessSyncToolPreset,
} from "@/harness-sync/types"

export const MODES: ReadonlyArray<HarnessSyncMode> = ["shared", "append", "custom", "off"]

export const logoInstance: Record<HarnessSyncToolID, { id: string; name: string }> = {
  tenon: { id: "opencode", name: "Tenon" },
  claude: { id: "claude-code", name: "Claude Code" },
  codex: { id: "codex", name: "Codex" },
  opencode: { id: "opencode-acp", name: "OpenCode" },
  antigravity: { id: "antigravity", name: "Antigravity" },
  "command-code": { id: "command-code", name: "Command Code" },
}

const DEFAULT_PRESET: HarnessSyncToolPreset = { mode: "shared", text: "" }

export const toolPreset = (tools: HarnessSyncPresets["tools"], id: HarnessSyncToolID) => tools[id] ?? DEFAULT_PRESET

export const presetsOf = (document: HarnessSyncDocumentView): HarnessSyncPresets => ({
  shared: document.shared,
  tools: structuredClone(document.tools),
  sharedSkills: [...document.sharedSkills],
  skillSources: {},
})

export function renderPreset(shared: string, tool: HarnessSyncToolPreset) {
  if (tool.mode === "off") return undefined
  const text =
    tool.mode === "shared"
      ? shared
      : tool.mode === "custom"
        ? tool.text
        : !tool.text.trim()
          ? shared
          : !shared.trim()
            ? tool.text
            : `${shared.trimEnd()}\n\n${tool.text.trimStart()}`
  return text === "" || text.endsWith("\n") ? text : `${text}\n`
}

export function presetFromFile(shared: string, text: string): Pick<HarnessSyncToolPreset, "mode" | "text"> {
  const base = shared.trimEnd()
  if (!base) return { mode: "custom", text }
  if (text.trimEnd() === base) return { mode: "shared", text: "" }
  if (text.startsWith(`${base}\n`)) return { mode: "append", text: text.slice(base.length).trimStart() }
  return { mode: "custom", text }
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export const instructionsChanged = (a: HarnessSyncPresets, b: HarnessSyncPresets) =>
  a.shared !== b.shared ||
  Object.keys({ ...a.tools, ...b.tools }).some((id) => {
    const left = toolPreset(a.tools, id as HarnessSyncToolID)
    const right = toolPreset(b.tools, id as HarnessSyncToolID)
    return left.mode !== right.mode || left.text !== right.text
  })

export const skillsChanged = (a: HarnessSyncPresets, b: HarnessSyncPresets) =>
  !same(a.sharedSkills, b.sharedSkills) ||
  Object.keys(a.skillSources).length + Object.keys(b.skillSources).length > 0 ||
  Object.keys({ ...a.tools, ...b.tools }).some((id) => {
    const left = toolPreset(a.tools, id as HarnessSyncToolID)
    const right = toolPreset(b.tools, id as HarnessSyncToolID)
    return (
      (left.skillMode ?? "shared") !== (right.skillMode ?? "shared") ||
      !same(left.skillExtras ?? [], right.skillExtras ?? [])
    )
  })

export const withInstructions = (saved: HarnessSyncPresets, draft: HarnessSyncPresets): HarnessSyncPresets => ({
  ...saved,
  shared: draft.shared,
  tools: Object.fromEntries(
    [...new Set([...Object.keys(saved.tools), ...Object.keys(draft.tools)])].map((id) => {
      const key = id as HarnessSyncToolID
      const base = toolPreset(saved.tools, key)
      const edit = toolPreset(draft.tools, key)
      return [id, { ...base, mode: edit.mode, text: edit.text }]
    }),
  ),
  skillSources: {},
})

export const withSkills = (saved: HarnessSyncPresets, draft: HarnessSyncPresets): HarnessSyncPresets => ({
  ...saved,
  sharedSkills: draft.sharedSkills,
  skillSources: draft.skillSources,
  tools: Object.fromEntries(
    [...new Set([...Object.keys(saved.tools), ...Object.keys(draft.tools)])].map((id) => {
      const key = id as HarnessSyncToolID
      const base = toolPreset(saved.tools, key)
      const edit = toolPreset(draft.tools, key)
      return [
        id,
        {
          mode: base.mode,
          text: base.text,
          ...(edit.skillMode && edit.skillMode !== "shared" ? { skillMode: edit.skillMode } : {}),
          ...(edit.skillExtras?.length ? { skillExtras: edit.skillExtras } : {}),
        },
      ]
    }),
  ),
})

export const sharedUsers = (status: HarnessSyncStatus, draft: HarnessSyncPresets) =>
  status.tools
    .filter((tool) => tool.installed)
    .filter((tool) => ["shared", "append"].includes(toolPreset(draft.tools, tool.id).mode))
    .map((tool) => tool.name)

export type Headline =
  | { tone: "idle"; key: "setup" }
  | { tone: "error"; key: "unreadable"; detail: string }
  | { tone: "warn"; key: "failed"; names: string[] }
  | { tone: "warn"; key: "conflictCopy" }
  | { tone: "warn"; key: "outside"; names: string[] }
  | { tone: "warn"; key: "waiting" }
  | { tone: "ok"; key: "synced"; at?: string; by?: string }

export function headline(status: HarnessSyncStatus): Headline {
  if (!status.syncFile) return { tone: "idle", key: "setup" }
  if (status.error) return { tone: "error", key: "unreadable", detail: status.error }
  const wantedSkills = status.skills.tools.flatMap((group) => group.skills.filter((skill) => skill.wanted))
  const failed = [
    ...status.tools.filter((tool) => tool.state === "error").map((tool) => tool.name),
    ...new Set(wantedSkills.filter((skill) => skill.state === "error").map((skill) => skill.name)),
  ]
  if (failed.length) return { tone: "warn", key: "failed", names: failed }
  if (status.syncFile.conflictCopies.length) return { tone: "warn", key: "conflictCopy" }
  const outside = [
    ...status.tools.filter((tool) => tool.editedOutside).map((tool) => tool.name),
    ...new Set(wantedSkills.filter((skill) => skill.editedOutside).map((skill) => skill.name)),
  ]
  if (outside.length) return { tone: "warn", key: "outside", names: outside }
  if (status.tools.some((tool) => tool.state === "differs") || wantedSkills.some((skill) => skill.state === "differs"))
    return { tone: "warn", key: "waiting" }
  return { tone: "ok", key: "synced", at: status.document?.updatedAt, by: status.document?.updatedBy }
}

export function shareable(status: HarnessSyncStatus, draft: HarnessSyncPresets) {
  const seen = new Map<string, { name: string; description: string; tool: HarnessSyncToolID; files: number }>()
  status.skills.tools.forEach((group) =>
    group.skills
      .filter((skill) => skill.state === "local" && !draft.sharedSkills.includes(skill.name))
      .forEach((skill) => {
        if (!seen.has(skill.name))
          seen.set(skill.name, {
            name: skill.name,
            description: skill.description,
            tool: group.tool,
            files: skill.files,
          })
      }),
  )
  return [...seen.values()].toSorted((a, b) => a.name.localeCompare(b.name))
}

export function editedSkills(status: HarnessSyncStatus) {
  return status.skills.tools.flatMap((group) =>
    group.skills
      .filter((skill) => skill.wanted && skill.editedOutside && !skill.autoUpload)
      .map((skill) => ({ name: skill.name, tool: group.tool })),
  )
}
