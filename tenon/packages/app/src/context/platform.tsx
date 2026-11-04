import { createSimpleContext } from "@tenon/ui/context"
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
export type DeviceInput =
  | { kind: "tap"; x: number; y: number }
  | { kind: "swipe"; x: number; y: number; toX: number; toY: number }
  | { kind: "text"; text: string }
  | { kind: "key"; key: "home" | "back" | "enter" }

/** Why dictation could not start or finish; `help` names the i18n key and settings URL for a denied microphone. */
export type DictationFailure = { code: string; help?: { key: string; url: string } }
export type DictationModelID = "whisper-small" | "whisper-turbo" | "parakeet-v3"
export type DictationModelState = {
  folder: string
  active?: DictationModelID
  models: { id: DictationModelID; name: string; size: number; downloaded: boolean }[]
}
export type DictationDownloadProgress = { id: DictationModelID; received: number; total: number }
/** Local dictation through the bundled tenon-dictation engine (desktop). */
export type DictationPlatform = {
  start(): Promise<{ error?: DictationFailure }>
  stop(): Promise<{ text?: string; error?: DictationFailure }>
  cancel(): Promise<void>
  onLevel(cb: (rms: number) => void): () => void
  /** The recording reached its length limit; the engine has stopped listening and `stop()` collects the text. */
  onLimit(cb: () => void): () => void
  models(): Promise<DictationModelState>
  setActive(id: DictationModelID): Promise<void>
  remove(id: DictationModelID): Promise<void>
  /** Settles with why a download stopped; `cancelled` when `cancelDownload` ended it. */
  download(id: DictationModelID): Promise<{ error?: string }>
  cancelDownload(id: DictationModelID): Promise<void>
  onDownloadProgress(cb: (progress: DictationDownloadProgress) => void): () => void
  openPermissionSettings(): Promise<void>
}

/** A mail account the Command Centre can search and draft in (desktop). */
export type MailAccount = { id: string; provider: "gmail" | "outlook" | "imap"; address: string }
export type MailImapInput = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  address?: string
}
/** Mail accounts owned by the Electron main process. Reading and drafts only; Tenon never sends email. */
export type MailPlatform = {
  /** Which sign-ins this build offers, and whether credentials can be stored encrypted. */
  available(): Promise<{ secureStorage: boolean; gmail: boolean; outlook: boolean; imap: boolean }>
  accounts(): Promise<MailAccount[]>
  connect(provider: "gmail" | "outlook"): Promise<MailAccount[]>
  addImap(input: MailImapInput): Promise<MailAccount[]>
  remove(id: string): Promise<MailAccount[]>
}

export type GoogleAccount = {
  id: string
  /** The account's address, read from its primary calendar. */
  email?: string
  label: string
  access: "read" | "write"
  lastSyncedAt?: string
  /** The last sync's failure for this account, kept until the next sync. */
  errorCode?: string
  pendingWrites: number
  failedWrites: number
}

/** The top-level fields summarize every account; `accounts` holds each one. */
export type GoogleCalendarConnection = {
  available: boolean
  configured: boolean
  /** The build ships its own OAuth client, so sign-in needs no typed credentials. */
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
  /** The user chose their version in a conflict, so the write ignores Google's etag. */
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
  /** The user chose their version in a conflict, so the write ignores Google's etag. */
  overwrite?: boolean
}

export type GoogleTaskWriteResult = {
  state: "synced" | "offline" | "failed" | "conflict"
  task: GoogleTaskProviderTask | null
}

export type GoogleCalendarPlatform = {
  status(): Promise<GoogleCalendarConnection>
  /** Adds an account, or renews the one signed in with the same address. */
  connect(input: {
    /** Omit both to use the build's own client. */
    clientId?: string
    clientSecret?: string
    access: "read" | "write"
    /** Electron main process supplies this; renderer values are ignored. */
    windowId?: number
  }): Promise<GoogleCalendarConnection>
  /** Syncs every account; one account failing leaves the others' results intact. */
  sync(): Promise<{
    events: GoogleCalendarProviderEvent[]
    tasks: GoogleTaskProviderTask[]
    /** Accounts whose items were fetched; the page replaces only those accounts' items. */
    syncedAccounts: string[]
    /** Finished outbox writes; the planner stops showing these as queued. `providerId` is Google's ID, if any. */
    settled: { idempotencyKey: string; providerId?: string }[]
    connection: GoogleCalendarConnection
  }>
  write(input: GoogleCalendarWrite): Promise<GoogleCalendarWriteResult>
  writeTask(input: GoogleTaskWrite): Promise<GoogleTaskWriteResult>
  /** Disconnects one account, or every account when none is named. */
  /** Drops a write in conflict, keeping Google's version; the next sync brings it back to the planner. */
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

type PlatformBase = {
  /** App version */
  version?: string

  /** Open a web or mail URL in the default system application */
  openExternal(url: string): void

  /** Open a local path in a local app (desktop only) */
  openPath?(path: string, app?: string): Promise<void>

  /** Open a local file URL in its default app (desktop only) */
  openLocalFile?(url: string): void
  /** A read-only URL for a file inside `directory` (desktop), for viewers that can't take a data URL. */
  fileViewerURL?(directory: string, path: string): Promise<string | undefined>
  /** The Workbench panel's browser (desktop). Agents use the same browser through the tenon MCP server. */
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
      cb: (state: { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }) => void,
    ): () => void
    onAgent(cb: (event: { tool: string }) => void): () => void
  }
  /** Phones for the Device tab (desktop): Android everywhere, the iOS Simulator on macOS. */
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

  /** Reveal a local path in the system file manager; false when the path does not exist (desktop only) */
  revealPath?(path: string): Promise<boolean>

  /** Restart the app  */
  restart(): Promise<void>

  /** Tells the desktop shell this window has unsaved edits, so a quit can ask before it stops the server. */
  setUnsavedChanges?(unsaved: boolean): void

  /** Send a system notification */
  notify(title: string, description?: string, onClick?: () => void): Promise<void>

  /** Open a native attachment picker and read selected files sequentially (desktop only) */
  openAttachmentPickerDialog?(
    opts: OpenAttachmentPickerOptions,
    onFile: (file: File) => Promise<unknown>,
  ): Promise<void>

  /** Resolve the native source path for a desktop File. */
  getPathForFile?(file: File): string

  /** Open a native save file picker dialog (desktop only) */
  saveSessionExport?(input: { filename: string; json: string }): Promise<boolean>
  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Prompt drafts, history, and their blobs. */
  draftStore?: DraftStore

  /** Stable platform window identity for window-scoped persistence */
  windowID?: string

  /** Application-global desktop updater */
  updater?: UpdaterPlatform

  /** Fetch override */
  fetch?: typeof fetch

  /** Google Calendar integration owned by the Electron main process */
  googleCalendar?: GoogleCalendarPlatform

  /** Local dictation (desktop only); absent in the web build, which hides the composer mic. */
  dictation?: DictationPlatform

  /** Mail accounts for the Command Centre (desktop only); absent in the web build, which hides Settings › Accounts. */
  mail?: MailPlatform

  /** The Tenon vault folder and whether the user chose it (desktop only). */
  getVaultFolder?(): Promise<{ folder: string; chosen: boolean }>
  /**
   * Pick another vault folder in a native dialog; null when cancelled. It takes effect after a restart; a folder
   * inside a repository or workspace is refused with `error: "inside_workspace"`; a non-empty non-vault folder
   * (`not_empty`), one inside or around the vault (`nested`) or a failed copy (`copy_failed`) too. The current
   * vault is copied over and kept; `previous` names it (desktop only).
   */
  chooseVaultFolder?(): Promise<
    | { folder: string; restartRequired: boolean; previous?: string }
    | { error: "inside_workspace" | "not_empty" | "nested" | "copy_failed"; folder: string }
    | null
  >

  /** Get the configured default server URL (platform-specific) */
  getDefaultServer?(): Promise<ServerConnection.Key | null>

  /** Set the default server URL to use on app startup (platform-specific) */
  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  /** Manage WSL sidecar servers (Electron on Windows only) */
  wslServers?: WslServersPlatform

  /** Get the preferred display backend (desktop only) */
  getDisplayBackend?(): Promise<DisplayBackend | null> | DisplayBackend | null

  /** Set the preferred display backend (desktop only) */
  setDisplayBackend?(backend: DisplayBackend): Promise<void>

  /** Webview zoom level (desktop only) */
  webviewZoom?: Accessor<number>

  /** Whether the native desktop window is fullscreen */
  windowFullscreen?: Accessor<boolean>

  /** Get whether native pinch/Ctrl-scroll zoom gestures are enabled (desktop only) */
  getPinchZoomEnabled?(): Promise<boolean> | boolean

  /** Allow native pinch/Ctrl-scroll zoom gestures (desktop only) */
  setPinchZoomEnabled?(enabled: boolean): Promise<void> | void

  /** Run a desktop-only menu action from the app chrome */
  runDesktopMenuAction?(action: DesktopMenuAction): Promise<void> | void

  /** Check if an editor app exists (desktop only) */
  checkAppExists?(appName: string): Promise<boolean>

  /** Read image from clipboard (desktop only) */
  readClipboardImage?(): Promise<File | null>

  /** Export collected diagnostic logs (desktop only) */
  exportDebugLogs?(): Promise<string>

  /** Force focus styles on interactive elements through desktop devtools (desktop only) */
  setForceFocus?(enabled: boolean): Promise<void>

  /** Record a fatal renderer error in platform logs (desktop only) */
  recordFatalRendererError?(error: FatalRendererErrorLog): Promise<void>

  /** Log one startup milestone with its time since this page began loading, once per page (desktop only) */
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
