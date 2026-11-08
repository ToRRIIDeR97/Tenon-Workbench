import path from "node:path"

// Opened by the shell, these run code rather than show a document.
const windowsLaunchers = [
  ".lnk",
  ".hta",
  ".msi",
  ".msp",
  ".scr",
  ".url",
  ".appref-ms",
  ".reg",
  ".pif",
  ".cpl",
  ".jar",
  ".chm",
  ".application",
  ".appinstaller",
  ".msix",
  ".settingcontent-ms",
  ".rdp",
  ".scf",
  ".theme",
  ".themepack",
  ".library-ms",
  ".search-ms",
  ".inf",
  ".sct",
  ".wsc",
  ".xll",
  ".diagcab",
]
const windowsDefaultPathext = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.PS1"
const macLaunchers = [
  ".app",
  ".command",
  ".terminal",
  ".workflow",
  ".tool",
  ".pkg",
  ".mpkg",
  ".scpt",
  ".scptd",
  ".fileloc",
  ".webloc",
  ".inetloc",
  ".mobileconfig",
  ".dmg",
  ".vncloc",
  ".rdp",
]

/**
 * Whether a local file link may be opened with its default app or should only be revealed in the
 * file manager. Executables are revealed: on Windows by the default PATHEXT, the user's PATHEXT and
 * shell launchers (a custom PATHEXT adds to the defaults, never replaces them), on macOS
 * by bundle and script extensions, and on any POSIX system when an execute bit is set. A Windows
 * file name with a colon names an alternate data stream (`a.exe::$DATA`), which hides the extension.
 */
export function localFileAction(
  file: string,
  info: { isDirectory: boolean; mode: number },
  platform: NodeJS.Platform = process.platform,
  pathext = process.env.PATHEXT,
): "open" | "reveal" {
  if (platform === "win32") {
    const name = path.win32.basename(file)
    if (name.includes(":")) return "reveal"
    const extension = path.win32.extname(name).toLowerCase()
    const executable = `${windowsDefaultPathext};${pathext ?? ""}`
      .split(";")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    return [...executable, ...windowsLaunchers].includes(extension) ? "reveal" : "open"
  }
  if (platform === "darwin" && macLaunchers.includes(path.posix.extname(file).toLowerCase())) return "reveal"
  if (info.isDirectory) return "open"
  return (info.mode & 0o111) !== 0 ? "reveal" : "open"
}

/**
 * A UNC or device path: `\\host\share`, `\\?\C:\x`, `//host/share`. Windows also reads `/\host` as UNC.
 * Touching one (stat, open, reveal) can make Windows authenticate to a remote host and leak NTLM
 * credentials, so local-file handlers refuse them on every platform.
 */
export function isUncPath(value: string) {
  return /^[\\/]{2}/.test(value)
}

// The applications "Open in" offers, by the `openWith` names in
// packages/app/src/components/session/open-in-app.tsx. Keep the two in step.
const openWithApps: Partial<Record<NodeJS.Platform, ReadonlySet<string>>> = {
  darwin: new Set([
    "Visual Studio Code",
    "Cursor",
    "Zed",
    "TextMate",
    "Antigravity",
    "Terminal",
    "iTerm",
    "Ghostty",
    "Warp",
    "Xcode",
    "Android Studio",
    "Sublime Text",
  ]),
  win32: new Set(["code", "cursor", "zed", "powershell", "Sublime Text"]),
  linux: new Set(["code", "cursor", "zed", "Sublime Text"]),
}

/** Whether the renderer may ask main to open a folder with `app` on `platform`: only the apps "Open in" lists. */
export function isOpenWithApp(app: string, platform: NodeJS.Platform = process.platform) {
  return openWithApps[platform]?.has(app) ?? false
}
