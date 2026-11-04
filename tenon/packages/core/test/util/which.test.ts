import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { resolveWin32, spawnTarget, which } from "@tenon/core/util/which"
import { tmpdir } from "../fixture/tmpdir"

async function cmd(dir: string, name: string, exec = true) {
  const ext = process.platform === "win32" ? ".cmd" : ""
  const file = path.join(dir, name + ext)
  const body = process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n"
  await fs.writeFile(file, body)
  if (process.platform !== "win32") {
    await fs.chmod(file, exec ? 0o755 : 0o644)
  }
  return file
}

function env(PATH: string): NodeJS.ProcessEnv {
  return {
    PATH,
    PATHEXT: process.env["PATHEXT"],
  }
}

function envPath(Path: string): NodeJS.ProcessEnv {
  return {
    Path,
    PathExt: process.env["PathExt"] ?? process.env["PATHEXT"],
  }
}

function same(a: string | null, b: string) {
  if (process.platform === "win32") {
    expect(a?.toLowerCase()).toBe(b.toLowerCase())
    return
  }

  expect(a).toBe(b)
}

describe("util.which", () => {
  test("returns null when command is missing", () => {
    expect(which("opencode-missing-command-for-test")).toBeNull()
  })

  test("finds a command from PATH override", async () => {
    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    const file = await cmd(bin, "tool")

    same(which("tool", env(bin)), file)
  })

  test("uses first PATH match", async () => {
    await using tmp = await tmpdir()
    const a = path.join(tmp.path, "a")
    const b = path.join(tmp.path, "b")
    await fs.mkdir(a)
    await fs.mkdir(b)
    const first = await cmd(a, "dupe")
    await cmd(b, "dupe")

    same(which("dupe", env([a, b].join(path.delimiter))), first)
  })

  test("returns null for non-executable file on unix", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    await cmd(bin, "noexec", false)

    expect(which("noexec", env(bin))).toBeNull()
  })

  test("uses PATHEXT on windows", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    const file = path.join(bin, "pathext.CMD")
    await fs.writeFile(file, "@echo off\r\n")

    expect(which("pathext", { PATH: bin, PATHEXT: ".CMD" })).toBe(file)
  })

  test("uses Windows Path casing fallback", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    const file = await cmd(bin, "mixed")

    same(which("mixed", envPath(bin)), file)
  })
})

describe("util.which resolveWin32", () => {
  const env = { Path: "C:\\tools;.;relative\\bin;\"C:\\Program Files\\Git\\cmd\"", PATHEXT: ".exe;.cmd" }

  test("takes bare names from PATH entries in PATHEXT order, never relative entries", () => {
    const files = new Set(["C:\\Program Files\\Git\\cmd\\git.cmd", ".\\git.exe", "relative\\bin\\git.exe"])
    expect(resolveWin32("git", env, (file) => files.has(file))).toBe("C:\\Program Files\\Git\\cmd\\git.cmd")
  })

  test("keeps a name that already has an extension", () => {
    const files = new Set(["C:\\tools\\tool.exe"])
    expect(resolveWin32("tool.exe", env, (file) => files.has(file))).toBe("C:\\tools\\tool.exe")
  })

  test("returns null rather than the bare name when PATH has no match", () => {
    expect(resolveWin32("git", env, () => false)).toBeNull()
  })
})

describe("util.which spawnTarget", () => {
  test("passes explicit paths through", () => {
    expect(spawnTarget("./tool.cmd")).toBe("./tool.cmd")
    expect(spawnTarget("C:\\tools\\tool.exe")).toBe("C:\\tools\\tool.exe")
  })

  test("resolves bare names on Windows only", () => {
    const missing = "opencode-missing-command-for-test"
    expect(spawnTarget(missing)).toBe(process.platform === "win32" ? null : missing)
  })
})
