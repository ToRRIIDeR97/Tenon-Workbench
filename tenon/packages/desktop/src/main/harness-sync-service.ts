import os from "node:os"
import path from "node:path"
import { app, BrowserWindow, dialog } from "electron"
import { createHarnessSync } from "./harness-sync/service"
import { locationsFromEnv, sandboxedLocations } from "./harness-sync/tools"

/**
 * Harness sync for the desktop app: state and backups in app data, sync files chosen in native dialogs, and changes
 * broadcast to every window. Development builds accept `TENON_HARNESS_SYNC_SANDBOX=<folder>`, which puts harness
 * files under `<folder>/home` and app data under `<folder>/app-data`, so testing never touches real harness files.
 */
export function createHarnessSyncService() {
  const sandbox = app.isPackaged ? undefined : process.env.TENON_HARNESS_SYNC_SANDBOX
  const owner = () => BrowserWindow.getFocusedWindow() ?? undefined
  const filters = [{ name: "Harness Sync file", extensions: ["json"] }]
  return createHarnessSync({
    locations: sandbox ? sandboxedLocations(path.join(sandbox, "home")) : locationsFromEnv(os.homedir(), process.env),
    dataDir: sandbox ? path.join(sandbox, "app-data") : path.join(app.getPath("userData"), "harness-sync"),
    async pickNewFile() {
      const options = {
        title: "Save the sync file in a Google Drive folder",
        defaultPath: "harness-sync.json",
        filters,
      }
      const window = owner()
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
      return result.canceled ? undefined : result.filePath
    },
    async pickExistingFile() {
      const options = { title: "Open your Harness Sync file", filters, properties: ["openFile" as const] }
      const window = owner()
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      return result.canceled ? undefined : result.filePaths[0]
    },
    changed: (notice) =>
      BrowserWindow.getAllWindows()
        .filter((window) => !window.isDestroyed())
        .forEach((window) => window.webContents.send("harness-sync-changed", notice ?? null)),
  })
}
