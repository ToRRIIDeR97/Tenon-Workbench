import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renameLegacyStoreFiles } from "./store-rename"

describe("renameLegacyStoreFiles", () => {
  test("moves pre-rename store files to tenon names and keeps existing tenon files", () => {
    const dir = mkdtempSync(join(tmpdir(), "tenon-store-rename-"))
    const files = {
      "opencode.settings": "settings",
      "opencode.updater": "updater",
      "opencode.global.dat": "old-global",
      "tenon.global.dat": "new-global",
      "opencode.workspace.repo.1a2b.dat": "workspace",
      "second-brain.google": "google",
      "opencode.log": "not a store",
    }
    for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), value)

    expect(renameLegacyStoreFiles(dir).sort()).toEqual([
      "tenon.settings",
      "tenon.updater",
      "tenon.workspace.repo.1a2b.dat",
    ])
    expect(readFileSync(join(dir, "tenon.global.dat"), "utf8")).toBe("new-global")
    expect(readdirSync(dir).sort()).toEqual([
      "opencode.global.dat",
      "opencode.log",
      "second-brain.google",
      "tenon.global.dat",
      "tenon.settings",
      "tenon.updater",
      "tenon.workspace.repo.1a2b.dat",
    ])
  })
})
