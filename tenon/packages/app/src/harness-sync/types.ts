export const HARNESS_SYNC_TOOLS = ["tenon", "claude", "codex", "opencode", "antigravity", "command-code"] as const
export type HarnessSyncToolID = (typeof HARNESS_SYNC_TOOLS)[number]

export type HarnessSyncMode = "shared" | "append" | "custom" | "off"

export type HarnessSyncToolPreset = {
  mode: HarnessSyncMode
  text: string
  skillMode?: HarnessSyncMode
  skillExtras?: string[]
}

export type HarnessSyncPresets = {
  shared: string
  tools: Partial<Record<HarnessSyncToolID, HarnessSyncToolPreset>>
  sharedSkills: string[]
  skillSources: Partial<Record<string, HarnessSyncToolID>>
}

export type HarnessSyncToolState =
  | "detected"
  | "inSync"
  | "differs"
  | "updated"
  | "skipped"
  | "off"
  | "notInstalled"
  | "error"

export type HarnessSyncToolStatus = {
  id: HarnessSyncToolID
  name: string
  installed: boolean
  path: string
  exists: boolean
  lines: number
  mode: HarnessSyncMode
  state: HarnessSyncToolState
  editedOutside: boolean
  message?: string
}

export type HarnessSyncSkillState = "inSync" | "differs" | "updated" | "error" | "local"

export type HarnessSyncLocalSkill = {
  name: string
  description: string
  files: number
  wanted: boolean
  state: HarnessSyncSkillState
  editedOutside: boolean
  autoUpload: boolean
  backup?: string
  message?: string
}

export type HarnessSyncToolSkills = { tool: HarnessSyncToolID; folder: string; skills: HarnessSyncLocalSkill[] }
export type HarnessSyncLibrarySkill = { name: string; description: string; files: number }
export type HarnessSyncSkillsReport = { library: HarnessSyncLibrarySkill[]; tools: HarnessSyncToolSkills[] }

export type HarnessSyncDocumentView = {
  revision: number
  updatedAt: string
  updatedBy: string
  shared: string
  tools: Partial<Record<HarnessSyncToolID, HarnessSyncToolPreset>>
  sharedSkills: string[]
}

export type HarnessSyncStatus = {
  deviceName: string
  syncFile?: { path: string; name: string; conflictCopies: string[] }
  document?: HarnessSyncDocumentView
  error?: string
  warning?: string
  lastChecked?: string
  pending?: { name: string; updatedBy: string; updatedAt: string }
  tools: HarnessSyncToolStatus[]
  skills: HarnessSyncSkillsReport
}

export type HarnessSyncNotice = { from: string; tools: number; skills: number }

export type HarnessSyncPlatform = {
  status(): Promise<HarnessSyncStatus>
  syncNow(): Promise<HarnessSyncStatus>
  readToolInstructions(tool: HarnessSyncToolID): Promise<string>
  createSyncFile(seedTool?: HarnessSyncToolID): Promise<HarnessSyncStatus | null>
  openSyncFile(): Promise<HarnessSyncStatus | null>
  join(seedTool?: HarnessSyncToolID): Promise<HarnessSyncStatus>
  cancelJoin(): Promise<HarnessSyncStatus>
  useThisComputer(seedTool: HarnessSyncToolID, expectedRevision: number): Promise<HarnessSyncStatus>
  disconnect(): Promise<HarnessSyncStatus>
  save(presets: HarnessSyncPresets, expectedRevision: number): Promise<HarnessSyncStatus>
  setDeviceName(name: string): Promise<HarnessSyncStatus>
  onChange(cb: (notice: HarnessSyncNotice | null) => void): () => void
}
