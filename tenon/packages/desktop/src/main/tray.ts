import { app, Menu, nativeImage, Tray } from "electron"
import { nativeT } from "./native-translations"
import { iconPath, setHiddenToBackgroundHandler, showMainWindows } from "./windows"

let tray: Tray | undefined
let told = false

export function createBackgroundTray() {
  if (tray || process.platform === "darwin") return
  const icon = nativeImage.createFromPath(iconPath())
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }))
  tray.setToolTip(app.getName())
  tray.on("click", () => showMainWindows())
  tray.on("double-click", () => showMainWindows())
  refreshBackgroundTray()
  setHiddenToBackgroundHandler(() => {
    if (told || process.platform !== "win32" || !tray) return
    told = true
    tray.displayBalloon({
      title: nativeT("secondBrain.desktop.tray.running"),
      content: nativeT("secondBrain.desktop.tray.runningDetail"),
      noSound: true,
    })
  })
  app.once("will-quit", () => {
    tray?.destroy()
    tray = undefined
  })
}

export function refreshBackgroundTray() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: nativeT("secondBrain.desktop.tray.open"), click: () => showMainWindows() },
      { type: "separator" },
      { label: nativeT("secondBrain.desktop.tray.quit"), click: () => app.quit() },
    ]),
  )
}
