import { expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { Database } from "@tenon/core/database/database"
import { tmpdir } from "./fixture/tmpdir"

test("moves a pre-rename database and its WAL files to the Tenon name", async () => {
  await using tmp = await tmpdir()
  for (const suffix of ["", "-wal", "-shm"])
    writeFileSync(path.join(tmp.path, `opencode-beta.db${suffix}`), `old${suffix}`)

  const target = path.join(tmp.path, "tenon-beta.db")
  Database.adoptLegacyFile(target)

  expect(readFileSync(target, "utf8")).toBe("old")
  expect(readFileSync(`${target}-wal`, "utf8")).toBe("old-wal")
  expect(existsSync(path.join(tmp.path, "opencode-beta.db"))).toBe(false)
})

test("leaves both files alone when the Tenon database already exists", async () => {
  await using tmp = await tmpdir()
  writeFileSync(path.join(tmp.path, "opencode.db"), "old")
  writeFileSync(path.join(tmp.path, "tenon.db"), "new")

  Database.adoptLegacyFile(path.join(tmp.path, "tenon.db"))

  expect(readFileSync(path.join(tmp.path, "tenon.db"), "utf8")).toBe("new")
  expect(readFileSync(path.join(tmp.path, "opencode.db"), "utf8")).toBe("old")
})
