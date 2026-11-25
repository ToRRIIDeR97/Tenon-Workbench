import { app, globalShortcut, type BrowserWindow } from "electron"
import { write as writeLog } from "./logging"
import { createMainWindow, createWidgetWindow, getLastFocusedWindow, mainWindows, resizeWidgetWindow } from "./windows"

export const WIDGET_SHORTCUTS = ["CommandOrControl+Alt+Space", "CommandOrControl+Alt+W"]

let widget: BrowserWindow | undefined

function current() {
  if (widget && !widget.isDestroyed()) return widget
  widget = createWidgetWindow()
  widget.on("closed", () => (widget = undefined))
  return widget
}

export function showWidget() {
  const win = current()
  if (win.webContents.isLoading()) {
    win.once("ready-to-show", () => win.show())
    return
  }
  win.show()
}

export function hideWidget() {
  if (widget && !widget.isDestroyed()) widget.hide()
}

export function toggleWidget() {
  if (widget && !widget.isDestroyed() && widget.isVisible()) return hideWidget()
  showWidget()
}

export function resizeWidget(height: number) {
  if (widget && !widget.isDestroyed()) resizeWidgetWindow(widget, height)
}

export function openInApp(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) return
  const focused = getLastFocusedWindow()
  const target = focused && mainWindows().includes(focused) ? focused : (mainWindows()[0] ?? createMainWindow())
  const send = () => target.webContents.send("navigate", path)
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
  if (target.webContents.isLoading()) target.webContents.once("did-finish-load", send)
  else send()
}

export function registerWidgetShortcut() {
  const accelerator = WIDGET_SHORTCUTS.find((candidate) => globalShortcut.register(candidate, toggleWidget))
  if (!accelerator) {
    writeLog("widget", "global shortcut unavailable", { tried: WIDGET_SHORTCUTS }, "warn")
    return
  }
  writeLog("widget", "global shortcut registered", { accelerator })
  app.once("will-quit", () => globalShortcut.unregister(accelerator))
}
