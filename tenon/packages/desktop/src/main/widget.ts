import { app, globalShortcut, type BrowserWindow } from "electron"
import { write as writeLog } from "./logging"
import { createMainWindow, createWidgetWindow, getLastFocusedWindow, mainWindows, resizeWidgetWindow } from "./windows"

/**
 * The desktop widget's lifecycle: one window, created on first show and reused. The global shortcut
 * (Ctrl+Alt+Space on Windows, Cmd+Option+Space on macOS) and the "Desktop widget" command toggle it; its own
 * close button hides it. "Open in Tenon" brings a main window forward (opening one if none is left) and navigates it.
 */
export const WIDGET_SHORTCUT = "CommandOrControl+Alt+Space"

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

/** Brings a main window forward on `path` (an app route such as a thread's), opening one when none is left. */
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
  const ok = globalShortcut.register(WIDGET_SHORTCUT, toggleWidget)
  if (!ok) writeLog("widget", "global shortcut unavailable", { accelerator: WIDGET_SHORTCUT }, "warn")
  app.once("will-quit", () => globalShortcut.unregister(WIDGET_SHORTCUT))
}
