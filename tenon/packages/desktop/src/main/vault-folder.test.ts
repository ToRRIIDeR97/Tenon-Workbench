import { describe, expect, test } from "bun:test"
import path from "node:path"
import { insideCodeFolder, vaultFolder } from "./vault-folder"

describe("insideCodeFolder", () => {
  test("refuses folders inside a repository or workspace, below the home folder", () => {
    const win = new Set(["C:\\Users\\ana\\dev\\acme\\.git", "C:\\Users\\ana\\work\\.tenon\\workspace.json"])
    const winExists = (file: string) => win.has(file)
    expect(insideCodeFolder("C:\\Users\\ana\\dev\\acme\\notes", "C:\\Users\\ana", winExists, path.win32)).toBe(true)
    expect(insideCodeFolder("C:\\Users\\ana\\work", "C:\\Users\\ana", winExists, path.win32)).toBe(true)
    expect(insideCodeFolder("C:\\Users\\ana\\Documents\\Tenon", "C:\\Users\\ana", winExists, path.win32)).toBe(false)
    const mac = new Set(["/Users/ana/.git", "/Users/ana/dev/acme/.git"])
    const macExists = (file: string) => mac.has(file)
    expect(insideCodeFolder("/Users/ana/dev/acme/vault", "/Users/ana", macExists, path.posix)).toBe(true)
    // A dotfiles repository in the home folder does not refuse every folder.
    expect(insideCodeFolder("/Users/ana/Documents/Tenon", "/Users/ana", macExists, path.posix)).toBe(false)
    expect(insideCodeFolder("/Volumes/Sync/Tenon", "/Users/ana", macExists, path.posix)).toBe(false)
  })
})

describe("vaultFolder", () => {
  test("defaults to Documents/Tenon on Windows and macOS", () => {
    expect(vaultFolder(undefined, "C:\\Users\\ana\\OneDrive\\Documents", path.win32)).toBe(
      "C:\\Users\\ana\\OneDrive\\Documents\\Tenon",
    )
    expect(vaultFolder(undefined, "/Users/ana/Documents", path.posix)).toBe("/Users/ana/Documents/Tenon")
  })

  test("uses the folder the user chose when it is absolute", () => {
    expect(vaultFolder("D:\\Notes\\", "C:\\Users\\ana\\Documents", path.win32)).toBe("D:\\Notes")
    expect(vaultFolder("/Volumes/Sync/Tenon", "/Users/ana/Documents", path.posix)).toBe("/Volumes/Sync/Tenon")
    expect(vaultFolder("relative/folder", "/Users/ana/Documents", path.posix)).toBe("/Users/ana/Documents/Tenon")
    expect(vaultFolder(42, "/Users/ana/Documents", path.posix)).toBe("/Users/ana/Documents/Tenon")
  })
})
