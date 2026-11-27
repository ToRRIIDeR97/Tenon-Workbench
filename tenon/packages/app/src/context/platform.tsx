import { createSimpleContext } from "@tenon/ui/context"
import type { HarnessSyncPlatform } from "@/harness-sync/types"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor } from "solid-js"
import type { DesktopMenuAction } from "../desktop-menu"
import { ServerConnection } from "./server"
import type { WslServersPlatform } from "../wsl/types"
import type { UpdaterPlatform } from "../updater"
import type { DraftStore } from "@/utils/draft-store"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenAttachmentPickerOptions = {
  title?: string
  multiple?: boolean
  accept?: string[]
  extensions?: string[]
  defaultPath?: string
}
type SaveFilePickerOptions = { title?: string; defaultPath?: string }
type PlatformName = "web" | "desktop"
type DesktopOS = "macos" | "windows" | "linux"

export type DeviceInfo = { platform: "android" | "ios"; id: string; name: string; state: string }
export type BrowserFailure = {
  kind: "load" | "crashed" | "certificate"
  code: number | string
  description: string
  url: string
}
export type DeviceInput =
  | { kind: "tap"; x: number; y: number }
  | { kind: "swipe"; x: number; y: number; toX: number; toY: number }
  | { kind: "text"; text: string }
  | { kind: "key"; key: "home" | "back" | "enter" }

export type DictationFailure = { code: string; help?: { key: string; url: string } }
export type DictationModelID = "whisper-small" | "whisper-turbo" | "parakeet-v3"
export type DictationModelState = {
  folder: string
  active?: DictationModelID
  models: { id: DictationModelID; name: string; size: number; downloaded: boolean }[]
}
export type DictationDownloadProgress = { id: DictationModelID; received: number; total: number }
export type DictationPlatform = {
  start(options?: { language?: string }): Promise<{ error?: DictationFailure }>
  stop(): Promise<{ text?: string; error?: DictationFailure }>
  cancel(): Promise<void>
  onLevel(cb: (rms: number) => void): () => void
  onPartial?(cb: (text: string) => void): () => void
  transcribe?(samples: Float32Array): Promise<{ text?: string; error?: DictationFailure }>
  onBands?(cb: (values: number[]) => void): () => void
  onLimit(cb: () => void): () => void
  models(): Promise<DictationModelState>
  setActive(id: DictationModelID): Promise<void>
  remove(id: DictationModelID): Promise<void>
  download(id: DictationModelID): Promise<{ error?: string }>
  cancelDownload(id: DictationModelID): Promise<void>
  onDownloadProgress(cb: (progress: DictationDownloadProgress) => void): () => void
  openPermissionSettings(): Promise<void>
}

export type MailAccount = { id: string; provider: "gmail" | "outlook" | "imap"; address: string }
export type MailImapInput = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  address?: string
}
export type MailPlatform = {
  available(): Promise<{ secureStorage: boolean; gmail: boolean; outlook: boolean; imap: boolean }>
  accounts(): Promise<MailAccount[]>
  connect(provider: "gmail" | "outlook"): Promise<MailAccount[]>
  addImap(input: MailImapInput): Promise<MailAccount[]>
  remove(id: string): Promise<MailAccount[]>
}

export type GoogleAccount = {
  id: string
  email?: string
  label: string
  access: "read" | "write"
  lastSyncedAt?: string
  errorCode?: string
  pendingWrites: number
  failedWrites: number
}

export type GoogleCalendarConnection = {
  available: boolean
  configured: boolean
  builtInClient?: boolean
  connected: boolean
  access: "read" | "write"
  accountLabel?: string
  lastSyncedAt?: string
  errorCode?: string
  pendingWrites: number
  failedWrites: number
  accounts: GoogleAccount[]
}

export type GoogleCalendarProviderEvent = {
  accountId: string
  providerId: string
  calendarId: string
  title: string
  date: string
  endDate?: string
  start?: string
  end?: string
  details?: string
  timezone?: string
  allDay: boolean
  recurringSeriesId?: string
  participantCount: number
  etag?: string
}

export type GoogleCalendarWrite = {
  kind: "create" | "update" | "delete"
  idempotencyKey: string
  event: GoogleCalendarProviderEvent
  overwrite?: boolean
}

export type GoogleCalendarWriteResult = {
  state: "synced" | "offline" | "failed" | "conflict"
  event: GoogleCalendarProviderEvent | null
}

export type GoogleTaskProviderTask = {
  accountId: string
  providerId: string
  taskListId: string
  taskListTitle: string
  title: string
  notes?: string
  dueDate?: string
  completedAt?: string
  updatedAt: string
  etag?: string
}

export type GoogleTaskWrite = {
  kind: "create" | "update" | "delete"
  idempotencyKey: string
  task: GoogleTaskProviderTask
  overwrite?: boolean
}

export type GoogleTaskWriteResult = {
  state: "synced" | "offline" | "failed" | "conflict"
  task: GoogleTaskProviderTask | null
}

export type GoogleCalendarPlatform = {
  status(): Promise<GoogleCalendarConnection>
  connect(input: {
    clientId?: string
    clientSecret?: string
    access: "read" | "write"
    windowId?: number
  }): Promise<GoogleCalendarConnection>
  sync(): Promise<{
    events: GoogleCalendarProviderEvent[]
    tasks: GoogleTaskProviderTask[]
    syncedAccounts: string[]
    settled: { idempotencyKey: string; providerId?: string }[]
    connection: GoogleCalendarConnection
  }>
  write(input: GoogleCalendarWrite): Promise<GoogleCalendarWriteResult>
  writeTask(input: GoogleTaskWrite): Promise<GoogleTaskWriteResult>
  discardConflict(input: { idempotencyKey: string }): Promise<GoogleCalendarConnection>
  disconnect(input?: { accountId?: string }): Promise<GoogleCalendarConnection>
}

export type FatalRendererErrorLog = {
  error: string
  url: string
  version?: string
  platform: PlatformName
  os?: DesktopOS
}

export type ThreadSyncDesktopStatus = {
  secureStorage: boolean
  clientId: string | null
  signedIn: boolean
  signingIn: boolean
  key: boolean
  error: string | null
}

export type ThreadSyncPlatform = {
  status(): Promise<ThreadSyncDesktopStatus>
  setClient(input: { clientId: string; clientSecret: string }): Promise<ThreadSyncDesktopStatus>
  signIn(): Promise<ThreadSyncDesktopStatus>
  cancelSignIn(): Promise<void> | void
  signOut(): Promise<ThreadSyncDesktopStatus>
  createKey(): Promise<{ phrase: string; status: ThreadSyncDesktopStatus }>
  enterPhrase(phrase: string): Promise<ThreadSyncDesktopStatus>
  forgetKey(): Promise<ThreadSyncDesktopStatus>
}

type PlatformBase = {
  version?: string

  openExternal(url: string): void

  openPath?(path: string, app?: string): Promise<void>

  openLocalFile?(url: string): void
  fileViewerURL?(directory: string, path: string): Promise<string | undefined>
  browser?: {
    show(bounds?: { x: number; y: number; width: number; height: number }): Promise<void>
    navigate(url: string): Promise<void>
    history(direction: "back" | "forward" | "reload"): Promise<void>
    capture(rect?: { x: number; y: number; width: number; height: number }): Promise<string | undefined>
    pick(): Promise<{
      selector: string
      tag: string
      text: string
      html: string
      rect: { x: number; y: number; width: number; height: number }
      styles: Record<string, string>
    } | null>
    onState(
      cb: (state: {
        url: string
        title: string
        loading: boolean
        canGoBack: boolean
        canGoForward: boolean
        committed?: boolean
        error?: BrowserFailure
      }) => void,
    ): () => void
    onAgent(cb: (event: { tool: string }) => void): () => void
  }
  device?: {
    status(): Promise<{
      android: { sdk: boolean; devices: DeviceInfo[]; avds: string[] }
      ios: { supported: boolean; devices: DeviceInfo[]; input: boolean }
    }>
    boot(platform: DeviceInfo["platform"], id: string): Promise<void>
    screenshot(platform: DeviceInfo["platform"], id: string): Promise<string | undefined>
    input(platform: DeviceInfo["platform"], id: string, input: DeviceInput): Promise<void>
    onAgent(cb: (event: { tool: string; platform: DeviceInfo["platform"]; id: string }) => void): () => void
  }

  revealPath?(path: string): Promise<boolean>

  restart(): Promise<void>

  setUnsavedChanges?(unsaved: boolean): void

  notify(title: string, description?: string, onClick?: () => void): Promise<void>

  openAttachmentPickerDialog?(
    opts: OpenAttachmentPickerOptions,
    onFile: (file: File) => Promise<unknown>,
  ): Promise<void>

  getPathForFile?(file: File): string

  saveSessionExport?(input: { filename: string; json: string }): Promise<boolean>
  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  storage?: (name?: string) => SyncStorage | AsyncStorage

  draftStore?: DraftStore

  windowID?: string

  updater?: UpdaterPlatform

  fetch?: typeof fetch

  desktopWidget?: {
    toggle: () => Promise<void> | void
    hide: () => Promise<void> | void
    resize: (height: number) => Promise<void> | void
    openInApp: (path: string) => Promise<void> | void
  }

  googleCalendar?: GoogleCalendarPlatform

  dictation?: DictationPlatform

  mail?: MailPlatform

  harnessSync?: HarnessSyncPlatform

  threadSync?: ThreadSyncPlatform

  getVaultFolder?(): Promise<{ folder: string; chosen: boolean }>
  chooseVaultFolder?(): Promise<
    | { folder: string; restartRequired: boolean; previous?: string }
    | { error: "inside_workspace" | "not_empty" | "nested" | "copy_failed"; folder: string }
    | null
  >

  getDefaultServer?(): Promise<ServerConnection.Key | null>

  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  wslServers?: WslServersPlatform

  getDisplayBackend?(): Promise<DisplayBackend | null> | DisplayBackend | null

  setDisplayBackend?(backend: DisplayBackend): Promise<void>

  webviewZoom?: Accessor<number>

  windowFullscreen?: Accessor<boolean>

  getPinchZoomEnabled?(): Promise<boolean> | boolean

  setPinchZoomEnabled?(enabled: boolean): Promise<void> | void

  runDesktopMenuAction?(action: DesktopMenuAction): Promise<void> | void

  checkAppExists?(appName: string): Promise<boolean>

  readClipboardImage?(): Promise<File | null>

  exportDebugLogs?(): Promise<string>

  setForceFocus?(enabled: boolean): Promise<void>

  recordFatalRendererError?(error: FatalRendererErrorLog): Promise<void>

  recordStartupMilestone?(name: "first-route" | "bootstrap-settled"): void
}

export type Platform = PlatformBase &
  (
    | { platform: "web"; os?: never }
    | {
        platform: "desktop"
        os?: DesktopOS
        openDirectoryPickerDialog(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>
      }
  )

export type DisplayBackend = "auto" | "wayland"

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
