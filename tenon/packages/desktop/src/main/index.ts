import "./legacy-env"
import { answerThreadSyncBridge, blockBrowserOrigin, startBrowserBridge } from "./browser"
import { registerFileViewerProtocol } from "./file-viewer"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, networkInterfaces, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event, WebContents } from "electron"
import { app, BrowserWindow, dialog } from "electron"

import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import contextMenu from "electron-context-menu"

import type { ServerReadyData } from "../preload/types"
import { checkAppExists, resolveAppPath } from "./apps"
import { CHANNEL, DEEP_LINK_SCHEME } from "./constants"
import { createDeepLinkQueue, parseDeepLink, type DeepLink } from "./deep-links"
import { redactURL } from "./external-url"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { hideWidget, openInApp, registerWidgetShortcut, resizeWidget, toggleWidget } from "./widget"
import { forwardInitializationFailure } from "./initialization"
import { createGoogleCalendarService } from "./google-calendar"
import { createDesktopThreadSync, threadSyncServerEnv } from "./thread-sync/electron"
import { createRemoteAccess } from "./remote-access/controller"
import { getStore } from "./store"
import { createDictationService } from "./dictation-service"
import { createMailService, startMailEndpoint } from "./mail/service"
import { createHarnessSyncService } from "./harness-sync-service"
import { exportDebugLogs, initCrashReporter, initLogging, sinceProcessStart, write as writeLog } from "./logging"
import { createMenu } from "./menu"
import { createBackgroundTray, refreshBackgroundTray } from "./tray"
import {
  finishFirstLaunchOnboarding,
  initializeOldLayoutEligibility,
  isFirstLaunchOnboardingPending,
  isOldLayoutEligible,
} from "./onboarding"
import {
  getDefaultServerUrl,
  preferAppEnv,
  setDefaultServerUrl,
  spawnLocalServer,
  type SidecarListener,
} from "./server"
import { superviseSidecar } from "./sidecar-supervisor"
import { setupAutoUpdater, showUpdaterDialog } from "./updater"
import { safeWebContentsURL } from "./window-state"
import {
  confirmQuit,
  getLastFocusedWindow,
  registerRendererProtocol,
  setRelaunchHandler,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  skipUnloadPrompts,
  restoreMainWindows,
  showMainWindows,
} from "./windows"
import { createWslServersController } from "./wsl/servers"
import { registerWslIpcHandlers } from "./wsl/ipc"
import { spawnWslSidecar } from "./wsl/sidecar"
import { migrateUserData } from "./user-data-migration"
import { cleanupStoreFiles } from "./store-cleanup"
import { renameLegacyStoreFiles } from "./store-rename"
import { bundledCliPath, startBackgroundCli } from "./background-cli"
import { nativeT, setNativeTranslations } from "./native-translations"

const modulesLoadedAt = Date.now()

const APP_NAMES: Record<string, string> = {
  dev: "Tenon Workbench Dev",
  beta: "Tenon Workbench Beta",
  prod: "Tenon Workbench",
}
const APP_IDS: Record<string, string> = {
  dev: "io.github.torriider97.tenonworkbench.dev",
  beta: "io.github.torriider97.tenonworkbench.beta",
  prod: "io.github.torriider97.tenonworkbench",
}
const LEGACY_DEV_APP_ID = "ai.opencode.desktop.dev"
const TEST_ONBOARDING = process.env.TENON_TEST_ONBOARDING === "1"
const SIDECAR_V2_REQUESTED = process.env.TENON_SIDECAR_V2 === "1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"
const QUIT_STOP_TIMEOUT = 8_000
const UPDATER_START_DELAY = 5_000

let logger: ReturnType<typeof initLogging>
let server: SidecarListener | null = null

const deepLinks = createDeepLinkQueue()
const deepLinkSenders = new WeakSet<WebContents>()

function useEnvProxy() {
  try {
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  const win = getLastFocusedWindow()
  deepLinks.emit(urls, win ? { id: win.webContents.id, send: (next) => sendDeepLinks(win, next) } : undefined)
}

let deepLinkConfirmations = Promise.resolve()
function receiveDeepLinks(urls: string[], source: string) {
  for (const value of urls) {
    const link = parseDeepLink(value, (directory) => {
      try {
        return statSync(directory).isDirectory()
      } catch {
        return false
      }
    })
    logger.log("deep link received", { source, url: redactURL(value), accepted: Boolean(link) })
    if (!link) continue
    deepLinkConfirmations = deepLinkConfirmations
      .then(() => confirmDeepLink(link))
      .then((confirmed) => {
        if (confirmed) emitDeepLinks([link.url])
      })
      .catch((error) => logger.warn("deep link confirmation failed", error))
  }
}

async function confirmDeepLink(link: DeepLink) {
  await app.whenReady()
  const options = {
    type: "question" as const,
    buttons: [nativeT("secondBrain.desktop.deepLink.open"), nativeT("secondBrain.desktop.deepLink.cancel")],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message:
      link.kind === "open-project"
        ? nativeT("secondBrain.desktop.deepLink.openProject")
        : nativeT("secondBrain.desktop.deepLink.newSession"),
    detail: nativeT(
      link.kind === "open-project"
        ? "secondBrain.desktop.deepLink.openProject.detail"
        : "secondBrain.desktop.deepLink.newSession.detail",
      { path: link.directory },
    ),
  }
  const win = getLastFocusedWindow()
  const result = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
  return result.response === 0
}

function consumeInitialDeepLinks(sender: WebContents) {
  const id = sender.id
  if (!deepLinkSenders.has(sender)) {
    deepLinkSenders.add(sender)
    sender.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) deepLinks.forget(id)
    })
    sender.on("render-process-gone", () => deepLinks.forget(id))
    sender.once("destroyed", () => deepLinks.forget(id))
  }
  return deepLinks.consume(id)
}

function freePort(hostname: string) {
  return new Promise<number>((resolve, reject) => {
    const socket = createServer()
    socket.on("error", reject)
    socket.listen(0, hostname, () => {
      const address = socket.address()
      if (typeof address !== "object" || !address) {
        socket.close()
        reject(new Error("Failed to get port"))
        return
      }
      socket.close(() => resolve(address.port))
    })
  })
}

function isPortFree(hostname: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createServer()
    socket.once("error", () => resolve(false))
    socket.listen(port, hostname, () => socket.close(() => resolve(true)))
  })
}

function holdPort(hostname: string, port: number) {
  return new Promise<() => Promise<void>>((resolve, reject) => {
    const socket = createServer((connection) => connection.destroy())
    socket.once("error", reject)
    socket.listen(port, hostname, () => resolve(() => new Promise<void>((done) => socket.close(() => done()))))
  })
}

async function killSidecar() {
  if (!server) return
  const current = server
  server = null
  await current.stop()
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  try {
    process.chdir(homedir())
  } catch {}

  process.env.TENON_DISABLE_EMBEDDED_WEB_UI = "true"

  const channel = app.isPackaged ? CHANNEL : "dev"
  const appId = app.isPackaged ? APP_IDS[channel] : `${APP_IDS.dev}.local`
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `tenon-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.TENON_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  const userData = onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId)
  app.setName(APP_NAMES[channel])
  app.setAppUserModelId(appId)
  app.setPath("userData", userData)
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  const userDataMigration = (() => {
    if (onboardingTestRoot) return
    try {
      return migrateUserData(
        app.isPackaged && channel === "dev" ? join(app.getPath("appData"), LEGACY_DEV_APP_ID) : undefined,
        userData,
      )
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  })()
  const storeRename = (() => {
    try {
      return renameLegacyStoreFiles(app.getPath("userData"))
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  })()
  initializeOldLayoutEligibility(app.getPath("userData"))
  logger = initLogging()
  if (storeRename instanceof Error) logger.error("store file rename failed", { error: storeRename.message })
  else if (storeRename.length) logger.log("renamed pre-rename store files", { count: storeRename.length })
  if (userDataMigration instanceof Error)
    logger.error("user data migration failed; retrying on next start", { error: userDataMigration.message })
  else if (userDataMigration) logger.log("user data migration", { result: userDataMigration })
  initCrashReporter()

  const wslServers = createWslServersController(
    app.getVersion(),
    async (distro) => {
      logger.log("spawning wsl sidecar", { distro })
      return spawnWslSidecar(distro, {
        onLine: (line) => logger.log("wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
    {
      logger: {
        log: (message, meta) => logger.log(message, meta),
        error: (message, meta) => logger.error(message, meta),
      },
    },
  )
  const stopSidecars = async () => {
    await killSidecar()
    wslServers.stopAll()
  }
  const relaunch = () => {
    if (!confirmQuit()) return
    setAppQuitting()
    void stopSidecars().finally(() => {
      app.relaunch()
      app.quit()
    })
  }

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
    modulesLoaded: sinceProcessStart(modulesLoadedAt),
    sinceProcessStart: sinceProcessStart(),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  const shellEnv = preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith(`${DEEP_LINK_SCHEME}://`))
    if (urls.length) receiveDeepLinks(urls, "second-instance")
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    receiveDeepLinks([url], "open-url")
  })

  if (process.platform !== "darwin") {
    const urls = process.argv.filter((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`))
    if (urls.length) receiveDeepLinks(urls, "argv")
  }

  let quitStop: Promise<void> | undefined
  let quitStopped = false
  app.on("before-quit", (event) => {
    if (!confirmQuit()) {
      setAppQuitting(false)
      event.preventDefault()
      return
    }
    setAppQuitting()
    if (quitStopped || (!quitStop && !server)) return
    event.preventDefault()
    quitStop ??= Promise.race([stopSidecars(), new Promise<void>((resolve) => setTimeout(resolve, QUIT_STOP_TIMEOUT))])
      .catch((error) => logger.error("failed to stop sidecars before quit", error))
      .finally(() => {
        quitStopped = true
        app.quit()
      })
  })

  app.on("will-quit", () => {
    setAppQuitting()
    void stopSidecars()
  })

  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
  })

  setRelaunchHandler(() => {
    relaunch()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      skipUnloadPrompts()
      setAppQuitting()
      void stopSidecars().finally(() => app.quit())
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()

  yield* Effect.promise(() => app.whenReady())

  yield* Effect.promise(() => cleanupStoreFiles(app.getPath("userData"))).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.deleted.length === 0) return
        logger.log("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned })
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to clean scoped store files", error)
      }),
    ),
  )
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  registerRendererProtocol()
  registerFileViewerProtocol()
  setDockIcon()
  const updater = setupAutoUpdater(stopSidecars)
  const googleCalendar = createGoogleCalendarService()
  const mail = createMailService({ onGoogleGrant: googleCalendar.adoptGrant })
  const threadSync = createDesktopThreadSync()
  answerThreadSyncBridge((route) => threadSync.bridge(route))
  const remoteAccessStore = getStore("tenon.remote-access")
  const remoteAccess = createRemoteAccess({
    store: { get: (key) => remoteAccessStore.get(key), set: (key, value) => remoteAccessStore.set(key, value) },
    interfaces: () => networkInterfaces(),
  })
  app.once("will-quit", () => void remoteAccess.stop())
  const harnessSync = createHarnessSyncService()
  harnessSync.start()
  app.once("will-quit", () => harnessSync.stop())
  const menuDeps = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => void showUpdaterDialog(updater, true),
    relaunch,
  }
  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    relaunch,
    awaitInitialization: Effect.fnUntraced(
      function* () {
        logger.log("awaiting server ready")
        const res = yield* Deferred.await(serverReady)
        logger.log("server ready", { url: res.url })
        return res
      },
      (e) => Effect.runPromise(e),
    ),
    consumeInitialDeepLinks,
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    isFirstLaunchOnboardingPending,
    finishFirstLaunchOnboarding,
    isOldLayoutEligible,
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    checkAppExists: (appName) => checkAppExists(appName),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    updater,
    googleCalendar,
    showUpdater: () => showUpdaterDialog(updater, true),
    setBackgroundColor: (color) => setBackgroundColor(color),
    widget: { toggle: toggleWidget, hide: hideWidget, resize: resizeWidget, openInApp },
    exportDebugLogs: () => exportDebugLogs(),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
    recordStartupMilestone: (name, sinceNavigation) =>
      writeLog("main", "startup milestone", { name, sinceNavigation, sinceProcessStart: sinceProcessStart() }),
    setNativeTranslations: (bundle) => {
      if (!setNativeTranslations(bundle)) return
      createMenu(menuDeps)
      refreshBackgroundTray()
    },
    dictation: createDictationService(),
    mail,
    harnessSync,
    threadSync,
    remoteAccess,
  })
  registerWslIpcHandlers(wslServers)
  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)
  updateTimer.unref()
  app.once("will-quit", () => clearInterval(updateTimer))

  const loadingTask = yield* Effect.gen(function* () {
    const sidecarVersion = SIDECAR_V2_REQUESTED && CHANNEL === "dev" && existsSync(bundledCliPath()) ? "v2" : "v1"
    logger.log("sidecar connection started", { version: sidecarVersion })
    if (SIDECAR_V2_REQUESTED && sidecarVersion === "v1")
      logger.warn("v2 sidecar requested but unavailable: it needs a dev-channel build made with TENON_BUNDLE_CLI=1", {
        channel: CHANNEL,
      })

    const env = yield* Effect.promise(() => shellEnv)
    ensureLoopbackNoProxy()
    useEnvProxy()

    if (sidecarVersion === "v2") {
      logger.log("spawning v2 sidecar")
      const sidecar = yield* Effect.promise(() => startBackgroundCli(logger, env?.XDG_STATE_HOME))
      yield* Deferred.succeed(serverReady, {
        url: sidecar.url,
        username: sidecar.username,
        password: sidecar.password,
      })
      remoteAccess.setTarget(() => sidecar.url)
      void remoteAccess.start().catch((error: unknown) => logger.error("remote access failed to start", String(error)))

      if (process.platform === "win32") {
        void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
      }

      logger.log("loading task finished")
      return
    }

    const parsedPort = Number.parseInt(process.env.TENON_PORT ?? "", 10)
    const fixedPort = Number.isNaN(parsedPort) ? undefined : parsedPort
    const hostname = "127.0.0.1"
    const password = randomUUID()
    const [bridge, mailEndpoint] = yield* Effect.promise(() =>
      Promise.all([
        startBrowserBridge().catch((error: unknown) => {
          logger.error("browser bridge failed", String(error))
          return undefined
        }),
        startMailEndpoint(mail).catch((error: unknown) => {
          logger.error("mail endpoint failed", String(error))
          return undefined
        }),
      ]),
    )
    const bridgeEnv = {
      ...(bridge && { TENON_BROWSER_URL: bridge.url, TENON_BROWSER_TOKEN: bridge.token }),
      ...(mailEndpoint && { TENON_MAIL_URL: mailEndpoint.url, TENON_MAIL_TOKEN: mailEndpoint.token }),
      ...threadSyncServerEnv(),
    }
    const startSidecar = (port: number) =>
      superviseSidecar({
        spawn: () => {
          blockBrowserOrigin(`http://${hostname}:${port}`)
          return spawnLocalServer(hostname, port, password, {
            userDataPath: app.getPath("userData"),
            onStdout: (message) => writeLog("server", "stdout", { message }),
            onStderr: (message) => writeLog("server", "stderr", { message }, "warn"),
            onExit: (code) => writeLog("utility", "sidecar exited", { code }, "warn"),
            env: bridgeEnv,
          })
        },
        log: (message, meta) => writeLog("utility", message, meta, "warn"),
        hold: () => holdPort(hostname, port),
      })

    let port = fixedPort ?? (yield* Effect.promise(() => freePort(hostname)))
    logger.log("spawning sidecar", { url: `http://${hostname}:${port}` })
    let sidecar = startSidecar(port)
    server = sidecar
    for (let attempt = 1; ; attempt++) {
      const failure = yield* Effect.promise(() =>
        sidecar.initial.ready.then(
          () => undefined,
          (error: unknown) => error,
        ),
      )
      if (failure === undefined) break
      const raced = fixedPort === undefined && attempt < 3 && !(yield* Effect.promise(() => isPortFree(hostname, port)))
      if (!raced) return yield* Effect.die(failure)
      port = yield* Effect.promise(() => freePort(hostname))
      logger.log("sidecar port was taken, retrying", { url: `http://${hostname}:${port}`, attempt })
      sidecar = startSidecar(port)
      server = sidecar
    }
    const url = `http://${hostname}:${port}`

    yield* Effect.tryPromise({ try: (signal) => sidecar.initial.waitHealthy(signal), catch: (error) => error }).pipe(
      Effect.timeout("30 seconds"),
      Effect.catch((e) =>
        Effect.sync(() => {
          logger.error("sidecar health check failed", String(e))
        }),
      ),
    )
    yield* Deferred.succeed(serverReady, {
      url,
      username: "opencode",
      password,
    })
    remoteAccess.setTarget(() => url)
    void remoteAccess.start().catch((error: unknown) => logger.error("remote access failed to start", String(error)))

    if (process.platform === "win32") {
      void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
    }

    logger.log("loading task finished")
  }).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)

  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
  app.on("activate", () => {
    showMainWindows()
  })

  const windows = restoreMainWindows()
  registerWidgetShortcut()
  if (windows.length) createMenu(menuDeps)
  createBackgroundTray()

  const loaded = yield* Fiber.await(loadingTask)
  if (Exit.isFailure(loaded)) logger.error("loading task failed", Cause.pretty(loaded.cause))

  const updaterStart = setTimeout(() => void updater.start(), UPDATER_START_DELAY)
  updaterStart.unref()
  app.once("will-quit", () => clearTimeout(updaterStart))
})

Effect.runFork(
  main.pipe(Effect.catchCause((cause) => Effect.sync(() => logger.error("app startup failed", Cause.pretty(cause))))),
)
