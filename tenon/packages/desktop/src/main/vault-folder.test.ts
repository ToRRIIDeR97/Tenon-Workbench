import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { insideCodeFolder, moveVault, vaultFolder, within } from "./vault-folder"

describe("moveVault", () => {
  const scratch = async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "tenon-vault-move-"))
    const from = path.join(base, "old")
    await mkdir(path.join(from, "Acme", "Plans"), { recursive: true })
    await writeFile(path.join(from, "Acme", "workspace.json"), '{"version":1,"id":"workspace_a","name":"Acme"}\n')
    await writeFile(path.join(from, "Acme", "Plans", "Launch.md"), "# Launch\n")
    return { base, from, done: () => rm(base, { recursive: true, force: true }) }
  }

  test("copies the vault into an empty folder and leaves the old one as it was", async () => {
    const dir = await scratch()
    const to = path.join(dir.base, "new")
    await mkdir(to)
    await writeFile(path.join(to, ".DS_Store"), "")
    expect(await moveVault(dir.from, to)).toEqual({ previous: dir.from })
    expect(await readFile(path.join(to, "Acme", "Plans", "Launch.md"), "utf8")).toBe("# Launch\n")
    expect(await readFile(path.join(dir.from, "Acme", "Plans", "Launch.md"), "utf8")).toBe("# Launch\n")
    await dir.done()
  })

  test("uses an existing vault as it is and refuses other non-empty folders", async () => {
    const dir = await scratch()
    const other = path.join(dir.base, "other")
    await mkdir(path.join(other, "Synced"), { recursive: true })
    await writeFile(path.join(other, "Synced", "workspace.json"), "{}")
    expect(await moveVault(dir.from, other)).toEqual({})
    expect(await readdir(other)).toEqual(["Synced"])
    const busy = path.join(dir.base, "busy")
    await mkdir(busy)
    await writeFile(path.join(busy, "taxes.pdf"), "x")
    expect(await moveVault(dir.from, busy)).toEqual({ error: "not_empty" })
    expect(await readdir(busy)).toEqual(["taxes.pdf"])
    expect(await moveVault(dir.from, path.join(dir.from, "inside"))).toEqual({ error: "nested" })
    expect(await moveVault(dir.from, dir.from)).toEqual({})
    await dir.done()
  })

  test("within compares Windows paths without case and POSIX paths exactly", () => {
    expect(within("c:\\users\\ana\\vault\\sub", "C:\\Users\\Ana\\Vault", path.win32)).toBe(true)
    expect(within("C:\\Users\\Ana\\Vault2", "C:\\Users\\Ana\\Vault", path.win32)).toBe(false)
    expect(within("/Users/ana/Vault/sub", "/Users/ana/Vault", path.posix)).toBe(true)
    expect(within("/Users/ana/vault", "/Users/ana/Vault", path.posix)).toBe(false)
  })
})

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
