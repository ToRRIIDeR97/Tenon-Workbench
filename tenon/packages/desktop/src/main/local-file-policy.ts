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
  ".searchconnector-ms",
  ".desktopthemepackfile",
  ".msu",
  ".appx",
  ".appxbundle",
  ".msixbundle",
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
// A Java runtime runs these on every platform (Jar Launcher on macOS, binfmt or xdg-open on Linux).
const anyPlatformLaunchers = [".jar"]
// Python Launcher runs these on macOS.
const macFileLaunchers = [".py"]

/**
 * Whether a local file link may be opened with its default app or should only be revealed in the
 * file manager. Executables are revealed: on Windows by the default PATHEXT, the user's PATHEXT and
 * shell launchers (a custom PATHEXT adds to the defaults, never replaces them), on macOS
 * by bundle and script extensions, `.jar` on every platform, and on any POSIX system when an execute bit is set.
 * Off Windows, `.jar` and `.py` count only for files, so a project folder such as `discord.py` still opens. A Windows file name with a colon names an alternate data stream (`a.exe::$DATA`), which hides the extension.
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
    return [...executable, ...windowsLaunchers, ...anyPlatformLaunchers].includes(extension) ? "reveal" : "open"
  }
  const extension = path.posix.extname(file).toLowerCase()
  if (platform === "darwin" && macLaunchers.includes(extension)) return "reveal"
  if (info.isDirectory) return "open"
  if ([...anyPlatformLaunchers, ...(platform === "darwin" ? macFileLaunchers : [])].includes(extension)) return "reveal"
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

/**
 * How "Open in" starts `app` (resolved to the absolute `executable` off macOS) on `folder`. Windows
 * PowerShell reads a positional argument as `-Command`, so a folder named `x;iex(...)` or `x$(calc)`
 * would run as code: the folder is only the working directory, never an argument. PowerShell goes
 * through the System32 `cmd.exe /c start`, which gives it its own console window from the GUI
 * process; cmd re-parses its command line, which holds only the resolved PowerShell path. Editors
 * take the folder as their one argument; macOS uses `open -a`.
 */
export function openWithLaunch(
  app: string,
  folder: string,
  executable: string,
  platform: NodeJS.Platform = process.platform,
  systemRoot = process.env.SystemRoot ?? process.env.windir,
) {
  if (platform === "darwin") return { command: "open", args: ["-a", app, folder] }
  if (platform === "win32" && app === "powershell") {
    // A bare `cmd` would be looked up on PATH and in the current directory.
    if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error("SystemRoot is not set")
    return {
      command: path.win32.join(systemRoot, "System32", "cmd.exe"),
      args: ["/d", "/c", "start", "", executable, "-NoExit"],
      options: { cwd: folder, windowsHide: true },
    }
  }
  return { command: executable, args: [folder] }
}
