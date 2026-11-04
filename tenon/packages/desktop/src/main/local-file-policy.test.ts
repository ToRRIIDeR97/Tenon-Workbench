import { expect, test } from "bun:test"
import { localFileAction } from "./local-file-policy"

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
