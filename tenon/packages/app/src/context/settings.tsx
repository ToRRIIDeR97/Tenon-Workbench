import { type ModelProfile, profileFor } from "@/utils/model-profile"
import { createStore, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo, createSignal } from "solid-js"
import { createSimpleContext } from "@tenon/ui/context"
import { persisted } from "@/utils/persist"
import { usePlatform } from "@/context/platform"

export interface NotificationSettings {
  agent: boolean
  permissions: boolean
  errors: boolean
}

export interface SoundSettings {
  agentEnabled: boolean
  agent: string
  permissionsEnabled: boolean
  permissions: string
  errorsEnabled: boolean
  errors: string
  defaults?: number
}

export type ThreadWidth = "narrow" | "medium" | "wide" | "full"

export const threadWidthValue: Record<ThreadWidth, string> = {
  narrow: "640px",
  medium: "800px",
  wide: "960px",
  full: "100%",
}

export interface Settings {
  general: {
    autoSave: boolean
    followup: "queue" | "steer"
    workSteps: "grouped" | "rows"
    showFileTree: boolean
    showNavigation: boolean
    showStatus: boolean
    showTerminal: boolean
    showReasoningSummaries: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
    showCustomAgents: boolean
    mobileTitlebarPosition: "top" | "bottom"
    agentVisibilityInitialized?: boolean
  }
  appearance: {
    fontSize: number
    threadWidth?: ThreadWidth
    mono: string
    sans: string
    terminal: string
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  notifications: NotificationSettings
  sounds: SoundSettings
  calendar?: CalendarSyncSettings
  reminders?: { enabled?: boolean; eventLeadMinutes?: number; taskTime?: string }
  commandCentre?: Partial<CommandCentreSettings>
  dictation?: {
    language?: string
  }
  harnesses?: {
    hiddenModels?: Record<string, string[]>
    hiddenProviders?: Record<string, string[]>
    setupPrompted?: boolean
    defaults?: HarnessDefaults
    lastUsed?: HarnessChoice
    compaction?: Record<string, CompactionSetting>
  }
  modelProfiles?: Record<string, ModelProfile>
}

export type CompactionSetting = {
  model?: string
  reasoningEffort?: string
  coldMinutes: number
}

export const DEFAULT_COLD_MINUTES = 29

export function compactionModel(
  setting: CompactionSetting | undefined,
  idleMinutes: number,
): { id: string; reasoningEffort?: string } | undefined {
  if (!setting?.model || idleMinutes < setting.coldMinutes) return undefined
  return { id: setting.model, ...(setting.reasoningEffort ? { reasoningEffort: setting.reasoningEffort } : {}) }
}

export type CalendarSyncSettings = {
  autoSync: boolean
  intervalMinutes: number
  onOpen: boolean
  onFocus: boolean
}

export const defaultCalendarSync: CalendarSyncSettings = {
  autoSync: true,
  intervalMinutes: 15,
  onOpen: true,
  onFocus: true,
}

export type CommandCentreSettings = {
  harnessID?: string
  modelID?: string
  memoryDays: number
  compactedAt?: number
}

export const defaultCommandCentre: CommandCentreSettings = { memoryDays: 45 }

export function memoryDays(value: unknown) {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return defaultCommandCentre.memoryDays
  return Math.min(365, Math.max(1, Math.round(number)))
}

export type HarnessChoice = {
  harnessID: string
  model?: { id: string; reasoningEffort?: string; serviceTier?: string }
}
export type HarnessDefaults = HarnessChoice & { mode: "fixed" | "last" }

const [runChoice, setRunChoice] = createSignal<HarnessChoice>()

export function newThreadChoice(
  harnesses: { defaults?: HarnessDefaults; lastUsed?: HarnessChoice } | undefined,
  thisRun?: HarnessChoice,
) {
  if (thisRun) return thisRun
  const defaults = harnesses?.defaults
  if (!defaults) return harnesses?.lastUsed
  if (defaults.mode === "last") return harnesses?.lastUsed ?? defaults
  return defaults
}

export function withVisibleModels<T extends { id: string; models: ReadonlyArray<{ id: string }> }>(
  instance: T,
  hidden: ReadonlyArray<string> | undefined,
  hiddenProviders?: ReadonlyArray<string>,
): T {
  if (!hidden?.length && !hiddenProviders?.length) return instance
  const skip = new Set(hidden)
  const skipProviders = new Set(hiddenProviders)
  return {
    ...instance,
    models: instance.models.filter((model) => !skip.has(model.id) && !skipProviders.has(modelProvider(model.id) ?? "")),
  }
}

export function modelProvider(modelID: string) {
  const index = modelID.indexOf("/")
  return index > 0 ? modelID.slice(0, index) : undefined
}

export const monoDefault = "System Mono"
export const sansDefault = "Inter"
export const terminalDefault = "JetBrainsMono Nerd Font Mono"
export function hasExistingWebState(settings: Promise<string> | string | null, previousVersion: string | undefined) {
  return settings !== null || previousVersion !== undefined
}

export function initialAgentVisibility(initialized: boolean | undefined, existing: boolean, previousVersion?: string) {
  if (initialized === true) return
  return existing || previousVersion !== undefined
}

const monoFallback =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const sansFallback = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const terminalFallback =
  '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoBase = monoFallback
const sansBase = `Inter, ${sansFallback}`
const terminalBase = terminalFallback

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

export function terminalInput(font: string | undefined) {
  return input(font)
}

export function terminalFontFamily(font: string | undefined) {
  return stack(font, terminalBase)
}

const defaultSettings: Settings = {
  general: {
    autoSave: true,
    followup: "steer",
    workSteps: "grouped",
    showFileTree: false,
    showNavigation: false,
    showStatus: false,
    showTerminal: false,
    showReasoningSummaries: false,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
    showCustomAgents: false,
    mobileTitlebarPosition: "top",
  },
  appearance: {
    fontSize: 14,
    threadWidth: "narrow",
    mono: "",
    sans: "",
    terminal: "",
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
  },
  sounds: {
    agentEnabled: false,
    agent: "tenon-soft-done",
    permissionsEnabled: true,
    permissions: "tenon-soft-attention",
    errorsEnabled: true,
    errors: "tenon-soft-error",
    defaults: 2,
  },
}

const EARLIER_SOUNDS = { agent: "tenon-done", permissions: "tenon-attention", errors: "tenon-error" } as const

export function migrateSounds(value: unknown) {
  if (!value || typeof value !== "object" || !("sounds" in value)) return value
  const sounds = value.sounds
  if (!sounds || typeof sounds !== "object" || ("defaults" in sounds && sounds.defaults === 2)) return value
  const next: Record<string, unknown> = { ...sounds, defaults: 2 }
  for (const [key, earlier] of Object.entries(EARLIER_SOUNDS))
    if (next[key] === earlier) next[key] = defaultSettings.sounds[key as keyof typeof EARLIER_SOUNDS]
  return { ...value, sounds: next }
}

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const [store, setStore, settingsInit, ready] = persisted(
      { key: "settings.v3", migrate: migrateSounds },
      createStore<Settings>(defaultSettings),
    )
    const [launch, setLaunch, , launchReady] = persisted(
      "app-version.v1",
      createStore<{ version?: string }>({ version: undefined }),
    )
    const [launchState, setLaunchState] = createStore({
      classified: false,
      previous: undefined as string | undefined,
    })
    const showFileTree = withFallback(() => store.general?.showFileTree, defaultSettings.general.showFileTree)
    const showStatus = withFallback(() => store.general?.showStatus, defaultSettings.general.showStatus)
    const showCustomAgents = withFallback(
      () => store.general?.showCustomAgents,
      defaultSettings.general.showCustomAgents,
    )
    const visible = (preference: () => boolean) => createMemo(() => preference())
    const initializeAgentVisibility = (existing: boolean) => {
      const initial = initialAgentVisibility(store.general?.agentVisibilityInitialized, existing, launchState.previous)
      if (initial === undefined) return
      batch(() => {
        setStore("general", "showCustomAgents", initial)
        setStore("general", "agentVisibilityInitialized", true)
      })
    }

    createEffect(() => {
      if (!launchReady() || launchState.classified) return
      setLaunchState({
        classified: true,
        previous: launch.version,
      })
      if (!platform.version || launch.version === platform.version) return
      setLaunch("version", platform.version)
    })

    createEffect(() => {
      if (!ready() || !launchState.classified || platform.platform !== "web") return
      initializeAgentVisibility(hasExistingWebState(settingsInit, launchState.previous))
    })

    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.mono))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
      const width = store.appearance?.threadWidth
      root.style.setProperty(
        "--tenon-thread-width",
        threadWidthValue[width && width in threadWidthValue ? width : "narrow"],
      )
    })

    return {
      ready,
      get current() {
        return store
      },
      restore(next: Settings) {
        setStore(reconcile({ ...defaultSettings, ...next }))
      },
      general: {
        autoSave: withFallback(() => store.general?.autoSave, defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
        followup: withFallback(() => store.general?.followup, defaultSettings.general.followup),
        setFollowup(value: "queue" | "steer") {
          setStore("general", "followup", value)
        },
        workSteps: withFallback(() => store.general?.workSteps, defaultSettings.general.workSteps),
        setWorkSteps(value: "grouped" | "rows") {
          setStore("general", "workSteps", value)
        },
        showFileTree,
        setShowFileTree(value: boolean) {
          setStore("general", "showFileTree", value)
        },
        showNavigation: withFallback(() => store.general?.showNavigation, defaultSettings.general.showNavigation),
        setShowNavigation(value: boolean) {
          setStore("general", "showNavigation", value)
        },
        showStatus,
        setShowStatus(value: boolean) {
          setStore("general", "showStatus", value)
        },
        showTerminal: withFallback(() => store.general?.showTerminal, defaultSettings.general.showTerminal),
        setShowTerminal(value: boolean) {
          setStore("general", "showTerminal", value)
        },
        showReasoningSummaries: withFallback(
          () => store.general?.showReasoningSummaries,
          defaultSettings.general.showReasoningSummaries,
        ),
        setShowReasoningSummaries(value: boolean) {
          setStore("general", "showReasoningSummaries", value)
        },
        shellToolPartsExpanded: withFallback(
          () => store.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
        },
        editToolPartsExpanded: withFallback(
          () => store.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
        },
        showCustomAgents,
        setShowCustomAgents(value: boolean) {
          setStore("general", "showCustomAgents", value)
        },
        mobileTitlebarPosition: withFallback(
          () => store.general?.mobileTitlebarPosition,
          defaultSettings.general.mobileTitlebarPosition,
        ),
        setMobileTitlebarPosition(value: "top" | "bottom") {
          setStore("general", "mobileTitlebarPosition", value)
        },
        initializeAgentVisibility,
      },
      visibility: {
        fileTree: visible(showFileTree),
        status: visible(showStatus),
        customAgents: visible(showCustomAgents),
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        threadWidth: withFallback(() => store.appearance?.threadWidth, "narrow" as ThreadWidth),
        setThreadWidth(value: ThreadWidth) {
          setStore("appearance", "threadWidth", value)
        },
        font: withFallback(() => store.appearance?.mono, defaultSettings.appearance.mono),
        setFont(value: string) {
          setStore("appearance", "mono", value.trim() ? value : "")
        },
        uiFont: withFallback(() => store.appearance?.sans, defaultSettings.appearance.sans),
        setUIFont(value: string) {
          setStore("appearance", "sans", value.trim() ? value : "")
        },
        terminalFont: withFallback(() => store.appearance?.terminal, defaultSettings.appearance.terminal),
        setTerminalFont(value: string) {
          setStore("appearance", "terminal", value.trim() ? value : "")
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          setStore("keybinds", (current) => {
            if (!Object.prototype.hasOwnProperty.call(current, action)) return current
            const next = { ...current }
            delete next[action]
            return next
          })
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
        },
      },
      permissions: {
        autoApprove: withFallback(() => store.permissions?.autoApprove, defaultSettings.permissions.autoApprove),
        setAutoApprove(value: boolean) {
          setStore("permissions", "autoApprove", value)
        },
      },
      notifications: {
        agent: withFallback(() => store.notifications?.agent, defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
        },
        permissions: withFallback(() => store.notifications?.permissions, defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
        },
        errors: withFallback(() => store.notifications?.errors, defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
        },
      },
      calendar: {
        reminders: () => store.reminders,
        setReminders(value: NonNullable<Settings["reminders"]>) {
          setStore("reminders", (current) => ({ ...current, ...value }))
        },
        sync: (): CalendarSyncSettings => ({ ...defaultCalendarSync, ...store.calendar }),
        setSync(value: Partial<CalendarSyncSettings>) {
          setStore("calendar", (current) => ({ ...defaultCalendarSync, ...current, ...value }))
        },
      },
      commandCentre: {
        current: (): CommandCentreSettings => {
          const value = { ...defaultCommandCentre, ...store.commandCentre }
          return { ...value, memoryDays: memoryDays(value.memoryDays) }
        },
        set(value: Partial<CommandCentreSettings>) {
          setStore("commandCentre", (current) => ({ ...defaultCommandCentre, ...current, ...value }))
        },
      },
      modelProfiles: {
        all: () => store.modelProfiles ?? {},
        for: (modelID: string | undefined) => profileFor(store.modelProfiles, modelID),
        set(model: string, profile: Omit<ModelProfile, "updatedAt">) {
          setStore("modelProfiles", (current) => ({ ...current, [model]: { ...profile, updatedAt: Date.now() } }))
        },
        remove(model: string) {
          setStore("modelProfiles", (current) =>
            Object.fromEntries(Object.entries(current ?? {}).filter(([key]) => key !== model)),
          )
        },
      },
      harnesses: {
        setupPrompted: () => store.harnesses?.setupPrompted === true,
        setSetupPrompted() {
          setStore("harnesses", (value) => ({ ...value, setupPrompted: true }))
        },
        defaults: () => store.harnesses?.defaults,
        setDefaults(value: HarnessDefaults | undefined) {
          setStore("harnesses", (current) => ({ ...current, defaults: value }))
        },
        newThreadChoice: () => newThreadChoice(store.harnesses, runChoice()),
        setLastUsed(value: HarnessChoice) {
          setStore("harnesses", (current) => ({ ...current, lastUsed: value }))
        },
        setNewThreadChoice(value: HarnessChoice) {
          setRunChoice({ ...value, ...(value.model ? { model: { ...value.model } } : {}) })
          setStore("harnesses", (current) => ({ ...current, lastUsed: value }))
        },
        hiddenModels: (instanceID: string) => store.harnesses?.hiddenModels?.[instanceID] ?? [],
        setModelHidden(instanceID: string, modelID: string, hidden: boolean) {
          const current = store.harnesses?.hiddenModels?.[instanceID] ?? []
          const next = hidden ? [...new Set([...current, modelID])] : current.filter((item) => item !== modelID)
          setStore("harnesses", (value) => ({
            ...value,
            hiddenModels: { ...value?.hiddenModels, [instanceID]: next },
          }))
        },
        compaction: (instanceID: string) => store.harnesses?.compaction?.[instanceID],
        setCompaction(instanceID: string, value: CompactionSetting | undefined) {
          setStore("harnesses", (current) => {
            const next = { ...current?.compaction }
            if (value) next[instanceID] = value
            else delete next[instanceID]
            return { ...current, compaction: next }
          })
        },
        hiddenProviders: (instanceID: string) => store.harnesses?.hiddenProviders?.[instanceID] ?? [],
        setProviderHidden(instanceID: string, provider: string, hidden: boolean) {
          const current = store.harnesses?.hiddenProviders?.[instanceID] ?? []
          const next = hidden ? [...new Set([...current, provider])] : current.filter((item) => item !== provider)
          setStore("harnesses", (value) => ({
            ...value,
            hiddenProviders: { ...value?.hiddenProviders, [instanceID]: next },
          }))
        },
      },
      dictation: {
        language: () => store.dictation?.language,
        setLanguage(value: string) {
          setStore("dictation", (current) => ({ ...current, language: value }))
        },
      },
      sounds: {
        agentEnabled: withFallback(() => store.sounds?.agentEnabled, defaultSettings.sounds.agentEnabled),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
        },
        agent: withFallback(() => store.sounds?.agent, defaultSettings.sounds.agent),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
        },
        permissionsEnabled: withFallback(
          () => store.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
        },
        permissions: withFallback(() => store.sounds?.permissions, defaultSettings.sounds.permissions),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
      },
    }
  },
})
