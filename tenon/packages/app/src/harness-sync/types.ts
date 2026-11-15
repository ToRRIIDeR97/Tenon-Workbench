// Harness sync: one set of global instructions and skills written into every coding harness on this computer,
// shared between computers through one `harness-sync.json` file in a Google Drive for desktop folder. The Electron
// main process owns the files (desktop/src/main/harness-sync); these are the shapes it sends the renderer.

export const HARNESS_SYNC_TOOLS = ["tenon", "claude", "codex", "opencode", "antigravity", "command-code"] as const
export type HarnessSyncToolID = (typeof HARNESS_SYNC_TOOLS)[number]

/** `shared`: the shared preset. `append`: shared plus the tool's own text. `custom`: only its own. `off`: unmanaged. */
export type HarnessSyncMode = "shared" | "append" | "custom" | "off"

export type HarnessSyncToolPreset = {
  mode: HarnessSyncMode
  text: string
  /** Which skills the tool's skills folder gets, with the same meaning as `mode`. Absent means `shared`. */
  skillMode?: HarnessSyncMode
  /** Library skills added for `append`, or the whole set for `custom`. */
  skillExtras?: string[]
}

/** What the editor saves. Tools absent from `tools` use the shared preset. */
export type HarnessSyncPresets = {
  shared: string
  tools: Partial<Record<HarnessSyncToolID, HarnessSyncToolPreset>>
  sharedSkills: string[]
  /** Skills to read from this computer before saving: skill name to the tool whose copy is uploaded. */
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
  /** The tool's global instructions file, for display only. */
  path: string
  exists: boolean
  /** Non-empty lines in the current file. */
  lines: number
  mode: HarnessSyncMode
  state: HarnessSyncToolState
  /** The file changed since Tenon last wrote or confirmed it. */
  editedOutside: boolean
  message?: string
}

export type HarnessSyncSkillState = "inSync" | "differs" | "updated" | "error" | "local"

export type HarnessSyncLocalSkill = {
  name: string
  description: string
  files: number
  /** Part of this tool's skill set. */
  wanted: boolean
  state: HarnessSyncSkillState
  editedOutside: boolean
  /** An outside edit the background check uploads by itself, because nothing else changed since. */
  autoUpload: boolean
  /** Where this run saved the copy it replaced. */
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
  /** A sync file the user opened but has not yet joined. */
  pending?: { name: string; updatedBy: string; updatedAt: string }
  tools: HarnessSyncToolStatus[]
  skills: HarnessSyncSkillsReport
}

export type HarnessSyncNotice = { from: string; tools: number; skills: number }

/**
 * Harness sync, owned by the Electron main process (desktop only). The renderer passes tool IDs, skill names and
 * text, never paths: sync files are chosen in native dialogs. Calls reject with a message meant for the user.
 */
export type HarnessSyncPlatform = {
  status(): Promise<HarnessSyncStatus>
  /** Uploads safe outside skill edits, then writes every managed file, including ones edited outside Tenon. */
  syncNow(): Promise<HarnessSyncStatus>
  readToolInstructions(tool: HarnessSyncToolID): Promise<string>
  /** Saves a new sync file from a native dialog, seeded with `seedTool`'s current instructions. Null when cancelled. */
  createSyncFile(seedTool?: HarnessSyncToolID): Promise<HarnessSyncStatus | null>
  /** Stages an existing sync file from a native dialog; `join` connects it. Null when cancelled. */
  openSyncFile(): Promise<HarnessSyncStatus | null>
  /** Joins the staged file. With `seedTool`, this computer's files replace its presets first. */
  join(seedTool?: HarnessSyncToolID): Promise<HarnessSyncStatus>
  cancelJoin(): Promise<HarnessSyncStatus>
  /** Makes this computer's instruction files the presets every computer follows. */
  useThisComputer(seedTool: HarnessSyncToolID, expectedRevision: number): Promise<HarnessSyncStatus>
  disconnect(): Promise<HarnessSyncStatus>
  /** Saves if the file is still at `expectedRevision`, then applies. */
  save(presets: HarnessSyncPresets, expectedRevision: number): Promise<HarnessSyncStatus>
  setDeviceName(name: string): Promise<HarnessSyncStatus>
  /** The background check applied the sync file; `notice` is set when another computer saved what was applied. */
  onChange(cb: (notice: HarnessSyncNotice | null) => void): () => void
}
