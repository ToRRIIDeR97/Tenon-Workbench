import { describe, expect, test } from "bun:test"
import path from "node:path"
import { KnowledgeVault } from "../../src/knowledge/vault"

describe("KnowledgeVault", () => {
  test("the vault root defaults to Documents/Tenon and honours TENON_VAULT_DIR on both platforms", () => {
    expect(KnowledgeVault.rootFor({}, "C:\\Users\\ana", path.win32)).toBe("C:\\Users\\ana\\Documents\\Tenon")
    expect(KnowledgeVault.rootFor({}, "/Users/ana", path.posix)).toBe("/Users/ana/Documents/Tenon")
    expect(KnowledgeVault.rootFor({ TENON_VAULT_DIR: "D:\\Sync\\Vault\\" }, "C:\\Users\\ana", path.win32)).toBe(
      "D:\\Sync\\Vault",
    )
    expect(KnowledgeVault.rootFor({ TENON_VAULT_DIR: "  " }, "/Users/ana", path.posix)).toBe(
      "/Users/ana/Documents/Tenon",
    )
  })

  test("page paths are relative, slash-separated Markdown names that are safe on Windows and macOS", () => {
    for (const ok of ["Ideas.md", "Acme API/Auth redesign.md", "a/b/c.MD"])
      expect(KnowledgeVault.isPagePath(ok)).toBe(true)
    for (const bad of [
      "",
      "../escape.md",
      "a/../b.md",
      "/abs.md",
      "C:/abs.md",
      "a\\b.md",
      "notes.txt",
      ".history/x.md",
      "a/.hidden.md",
      "trailing./x.md",
      " lead.md",
      "con.md",
      "a//b.md",
      "what?.md",
    ])
      expect(KnowledgeVault.isPagePath(bad)).toBe(false)
  })

  test("a vault root inside a workspace or Project folder is detected on both platforms", () => {
    expect(KnowledgeVault.rootInside("C:\\dev\\acme\\vault", ["c:\\DEV\\acme"], path.win32)).toBe(true)
    expect(KnowledgeVault.rootInside("C:\\dev\\acme", ["C:\\dev\\acme\\"], path.win32)).toBe(true)
    expect(KnowledgeVault.rootInside("C:\\dev\\acme-notes", ["C:\\dev\\acme"], path.win32)).toBe(false)
    expect(KnowledgeVault.rootInside("/Users/ana/Documents/Tenon", ["/Users/ana/dev/acme"], path.posix)).toBe(false)
    expect(KnowledgeVault.rootInside("/Users/ana/dev/acme/notes", ["/Users/ana/dev/acme"], path.posix)).toBe(true)
    // posix paths keep their case.
    expect(KnowledgeVault.rootInside("/users/ana/dev/acme/notes", ["/Users/ana/dev/acme"], path.posix)).toBe(false)
  })

  test("conflict copies name the file they were copied from", () => {
    expect(KnowledgeVault.conflictOriginal("Plan (conflicted copy 2026-11-02).md")).toBe("Plan.md")
    expect(KnowledgeVault.conflictOriginal("Acme/Plan (Ana's conflicted copy).md")).toBe("Acme/Plan.md")
    expect(KnowledgeVault.conflictOriginal("Plan (Conflict 1).md")).toBe("Plan.md")
    expect(KnowledgeVault.conflictOriginal("Plan.sync-conflict-20261102-101010-ABCDEF.md")).toBe("Plan.md")
  })

  test("log lines parse into entries and other lines are ignored", () => {
    const parsed = KnowledgeVault.parseLog(
      "- 2026-11-02T10:00:00.000Z · agent · started · phase one\nnot an entry\r\n- 2026-11-02T11:00:00.000Z · you · done\n",
      "laptop-1a2b3c",
    )
    expect(parsed.map((item) => item.entry)).toEqual([
      { at: "2026-11-02T10:00:00.000Z", author: "agent", text: "started · phase one", machine: "laptop-1a2b3c" },
      { at: "2026-11-02T11:00:00.000Z", author: "you", text: "done", machine: "laptop-1a2b3c" },
    ])
  })

  test("names compare across letter case and Unicode forms, and new names are stored in NFC", () => {
    const nfc = "Caf\u00e9"
    const nfd = "Cafe\u0301"
    expect(KnowledgeVault.uniqueFolder(nfc, [nfd.toUpperCase()])).toBe(`${nfc} (2)`)
    expect(KnowledgeVault.uniqueFolder(nfd, [])).toBe(nfc)
    const projects = new Map([["project_1", nfd]])
    // A new page in a Project folder keeps the folder's spelling on disk, so NTFS gets no sibling folder.
    expect(KnowledgeVault.newPagePath(`${nfc}/${nfd}.md`, projects)).toBe(`${nfd}/${nfc}.md`)
    expect(KnowledgeVault.newPagePath(`${nfd}.md`, projects)).toBe(`${nfc}.md`)
    // Any other folder keeps the spelling given, so the page lands in the folder a listing named.
    expect(KnowledgeVault.newPagePath(`${nfd}/${nfd}.md`, new Map())).toBe(`${nfd}/${nfc}.md`)
  })

  test("a new page cannot have a stem whose .history folder would end in a dot or space", () => {
    for (const refused of ["Plan .md", "Plan..md", "a/Plan .md"]) {
      expect(KnowledgeVault.newPagePath(refused, new Map())).toBeUndefined()
      // Pages already on disk stay valid, so they keep listing.
      expect(KnowledgeVault.isPagePath(refused)).toBe(true)
    }
  })

  test("a moved vault keeps workspaces whose id reached the new root, on both platforms", () => {
    for (const [from, to, one, two] of [
      ["C:\\Old", "D:\\New", "C:\\dev\\one", "C:\\dev\\two"],
      ["/Users/ana/Old", "/Volumes/New", "/Users/ana/dev/one", "/Users/ana/dev/two"],
    ]) {
      const roots = { [from]: { [one]: "workspace_1", [two]: "workspace_2" }, [to]: { elsewhere: "workspace_3" } }
      expect(KnowledgeVault.workspacesUnder(roots, to, new Set(["workspace_1"]))).toEqual([one, "elsewhere"])
    }
  })

  test("machine ids are file-safe and differ per call", () => {
    const first = KnowledgeVault.machineName("Ana's MacBook Pro.local")
    expect(first).toMatch(/^Ana-s-MacBook-Pro-local-[0-9a-f]{6}$/)
    expect(KnowledgeVault.machineName("")).toMatch(/^machine-[0-9a-f]{6}$/)
    expect(KnowledgeVault.machineName("Ana's MacBook Pro.local")).not.toBe(first)
  })
})

test("a heading title is read in linear time and keeps CommonMark closing rules", () => {
  expect(KnowledgeVault.titleFromBody("intro\n# Plan ##\nbody")).toBe("Plan")
  expect(KnowledgeVault.titleFromBody("# Learn C#")).toBe("Learn C#")
  expect(KnowledgeVault.titleFromBody("#\nNot a heading")).toBe("")
  const started = performance.now()
  expect(KnowledgeVault.titleFromBody("# a" + " ".repeat(100_000) + "x")).toStartWith("a")
  expect(performance.now() - started).toBeLessThan(100)
})
