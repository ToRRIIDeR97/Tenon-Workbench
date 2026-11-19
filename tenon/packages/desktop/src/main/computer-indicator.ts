import { BrowserWindow, screen } from "electron"
import { nativeT } from "./native-translations"
import { glowPage, indicatorPage, notifyStop } from "./computer-indicator-page"

export { watch } from "./computer-indicator-page"

// The on-screen sign that an agent is using the computer (#333): a small always-on-top pill at the bottom of the
// display under the cursor with Stop, shown while Cua Driver actions run and gone a few quiet seconds after the last. Stop reaches the
// server through `computer_watch`, which the server holds open while computer use is active. A Tenon-blue glow frames
// the same display meanwhile; it lets every click through, so it never gets in the agent's or the user's way.

const QUIET_MS = 5_000
const state = {
  window: undefined as BrowserWindow | undefined,
  glow: undefined as BrowserWindow | undefined,
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
  harness: "",
}

function ensure() {
  if (state.window && !state.window.isDestroyed()) return state.window
  const window = new BrowserWindow({
    width: 320,
    height: 44,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
  })
  // Over full-screen apps too, so Stop is reachable from whatever the agent is driving.
  window.setAlwaysOnTop(true, "screen-saver")
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.webContents.on("page-title-updated", (event, title) => {
    event.preventDefault()
    if (title !== "stop") return
    hide()
    notifyStop()
  })
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  state.window = window
  return window
}

function ensureGlow() {
  if (state.glow && !state.glow.isDestroyed()) return state.glow
  const glow = new BrowserWindow({
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  })
  glow.setIgnoreMouseEvents(true)
  glow.setAlwaysOnTop(true, "screen-saver")
  glow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  glow.webContents.on("will-navigate", (event) => event.preventDefault())
  void glow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(glowPage())}`)
  state.glow = glow
  return glow
}

function hide() {
  clearTimeout(state.timer)
  if (state.window && !state.window.isDestroyed()) state.window.hide()
  if (state.glow && !state.glow.isDestroyed()) state.glow.hide()
}

/**
 * `computer_indicator`: an action started (show the pill and keep it), the last action ended (`idle`: hide after a
 * quiet moment), or computer use stopped (hide now). The pill opens on the display under the cursor.
 */
export function indicate(args: Record<string, unknown>, dark: boolean) {
  clearTimeout(state.timer)
  if (args.active !== true) {
    hide()
    return { text: "{}" }
  }
  if (args.idle === true) {
    state.timer = setTimeout(hide, QUIET_MS)
    return { text: "{}" }
  }
  const harness = typeof args.harness === "string" && args.harness ? args.harness.slice(0, 40) : "Tenon"
  const window = ensure()
  if (!window.isVisible() || state.harness !== harness) {
    state.harness = harness
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    // The glow goes up first, so the pill (and its Stop) stays above it.
    const glow = ensureGlow()
    glow.setBounds(display.bounds)
    glow.showInactive()
    window.setBounds({
      x: Math.round(area.x + area.width / 2 - 160),
      y: area.y + area.height - 64,
      width: 320,
      height: 44,
    })
    void window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        indicatorPage({
          label: nativeT("secondBrain.desktop.computer.active", { harness }),
          stop: nativeT("secondBrain.desktop.computer.stop"),
          dark,
        }),
      )}`,
    )
    window.showInactive()
  }
  return { text: "{}" }
}
