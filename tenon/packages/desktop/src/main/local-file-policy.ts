import path from "node:path"

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
const anyPlatformLaunchers = [".jar"]
const macFileLaunchers = [".py"]

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

export function isUncPath(value: string) {
  return /^[\\/]{2}/.test(value)
}

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

export function isOpenWithApp(app: string, platform: NodeJS.Platform = process.platform) {
  return openWithApps[platform]?.has(app) ?? false
}

export function openWithLaunch(
  app: string,
  folder: string,
  executable: string,
  platform: NodeJS.Platform = process.platform,
  systemRoot = process.env.SystemRoot ?? process.env.windir,
) {
  if (platform === "darwin") return { command: "open", args: ["-a", app, folder] }
  if (platform === "win32" && app === "powershell") {
    if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error("SystemRoot is not set")
    return {
      command: path.win32.join(systemRoot, "System32", "cmd.exe"),
      args: ["/d", "/c", "start", "", executable, "-NoExit"],
      options: { cwd: folder, windowsHide: true },
    }
  }
  return { command: executable, args: [folder] }
}
