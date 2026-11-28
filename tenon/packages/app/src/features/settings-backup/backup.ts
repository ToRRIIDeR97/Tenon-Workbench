export const BACKUP_FORMAT = "tenon-settings"
export const BACKUP_VERSION = 1

export const SETTING_SECTIONS = [
  "general",
  "appearance",
  "keybinds",
  "notifications",
  "sounds",
  "calendar",
  "reminders",
  "commandCentre",
  "dictation",
  "harnesses",
  "modelProfiles",
] as const

export type SettingSection = (typeof SETTING_SECTIONS)[number]
export type BackupSection = SettingSection | "mcp"

export type SettingsBackup = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  settings: Partial<Record<SettingSection, unknown>>
  mcp: Record<string, unknown>
}

const SECRET_FIELDS = ["environment", "headers", "oauth"] as const

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function blankValues(value: unknown): unknown {
  const fields = record(value)
  if (!fields) return typeof value === "string" ? "" : value
  return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, blankValues(item)]))
}

function withoutSecrets(entry: unknown) {
  const fields = record(entry)
  if (!fields) return entry
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) =>
      (SECRET_FIELDS as ReadonlyArray<string>).includes(key) ? [key, blankValues(value)] : [key, value],
    ),
  )
}

export function exportSettings(input: { settings: object; mcp: object | undefined; now: Date }): SettingsBackup {
  const settings = record(clone(input.settings)) ?? {}
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: input.now.toISOString(),
    settings: Object.fromEntries(
      SETTING_SECTIONS.flatMap((section) => (section in settings ? [[section, settings[section]]] : [])),
    ),
    mcp: Object.fromEntries(
      Object.entries(record(clone(input.mcp ?? {})) ?? {}).map(([name, entry]) => [name, withoutSecrets(entry)]),
    ),
  }
}

export function backupSections(file: SettingsBackup): BackupSection[] {
  return [
    ...SETTING_SECTIONS.filter((section) => section in file.settings),
    ...(Object.keys(file.mcp).length > 0 ? (["mcp"] as const) : []),
  ]
}

export type ParsedBackup = { ok: true; file: SettingsBackup; sections: BackupSection[] } | { ok: false; error: string }

export function parseSettingsBackup(text: string): ParsedBackup {
  const value = (() => {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  })()
  const fields = record(value)
  if (!fields) return { ok: false, error: "not_json" }
  if (fields.format !== BACKUP_FORMAT) return { ok: false, error: "not_tenon" }
  if (fields.version !== BACKUP_VERSION) return { ok: false, error: "version" }
  const settings = record(fields.settings)
  if (!settings) return { ok: false, error: "no_settings" }
  const file: SettingsBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof fields.exportedAt === "string" ? fields.exportedAt : "",
    settings: Object.fromEntries(
      SETTING_SECTIONS.flatMap((section) => (section in settings ? [[section, settings[section]]] : [])),
    ),
    mcp: record(fields.mcp) ?? {},
  }
  return { ok: true, file, sections: backupSections(file) }
}

export function mergeSettings<T extends object>(
  current: T,
  backup: SettingsBackup,
  sections: ReadonlyArray<BackupSection>,
): T {
  const next: Record<string, unknown> = { ...(current as Record<string, unknown>) }
  for (const section of sections) {
    if (!(SETTING_SECTIONS as ReadonlyArray<string>).includes(section)) continue
    if (!(section in backup.settings)) continue
    next[section] = clone(backup.settings[section as SettingSection])
  }
  return next as T
}

export function blankedSecrets(file: SettingsBackup) {
  const blank = (value: unknown): boolean => {
    const fields = record(value)
    if (!fields) return value === ""
    return Object.values(fields).some(blank)
  }
  return Object.entries(file.mcp)
    .filter(([, entry]) => {
      const fields = record(entry)
      return !!fields && SECRET_FIELDS.some((key) => key in fields && blank(fields[key]))
    })
    .map(([name]) => name)
}

export function backupFileName(now: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `tenon-settings-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}
