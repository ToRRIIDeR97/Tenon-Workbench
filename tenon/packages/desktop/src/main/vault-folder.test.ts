import { describe, expect, test } from "bun:test"
import path from "node:path"
import { vaultFolder } from "./vault-folder"

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
