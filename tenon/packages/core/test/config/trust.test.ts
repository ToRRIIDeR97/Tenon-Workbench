import { describe, expect, test } from "bun:test"
import path from "path"
import { ConfigTrust } from "@tenon/core/config/trust"

describe("ConfigTrust", () => {
  test("covers an approved folder and what is inside it, on either platform", () => {
    const posix = ["/home/me/repo"]
    expect(ConfigTrust.covers(posix, "/home/me/repo", path.posix)).toBe(true)
    expect(ConfigTrust.covers(posix, "/home/me/repo/.tenon", path.posix)).toBe(true)
    expect(ConfigTrust.covers(posix, "/home/me/repo-two", path.posix)).toBe(false)
    expect(ConfigTrust.covers(posix, "/home/me", path.posix)).toBe(false)

    const win32 = ["C:\\Users\\me\\repo"]
    expect(ConfigTrust.covers(win32, "c:/users/ME/repo/.tenon/tenon.json", path.win32)).toBe(true)
    expect(ConfigTrust.covers(win32, "D:\\Users\\me\\repo", path.win32)).toBe(false)
  })

  test("reads a damaged list as empty", () => {
    expect(ConfigTrust.parse(undefined)).toEqual([])
    expect(ConfigTrust.parse("{not json")).toEqual([])
    expect(ConfigTrust.parse('{"a":1}')).toEqual([])
    expect(ConfigTrust.parse(JSON.stringify(["relative", 1]))).toEqual([])
  })

  test("uses the repository as the folder an approval covers", () => {
    expect(ConfigTrust.root("/repo/sub", "/repo")).toBe("/repo")
    expect(ConfigTrust.root("/loose", "/")).toBe("/loose")
  })

  test("refuses rules that widen external_directory or .env reads", () => {
    expect(ConfigTrust.loosens("external_directory", "*", "allow")).toBe(true)
    expect(ConfigTrust.loosens("external_*", "/etc/*", "allow")).toBe(true)
    expect(ConfigTrust.loosens("*", "*", "allow")).toBe(true)
    expect(ConfigTrust.loosens("read", "*", "allow")).toBe(true)
    expect(ConfigTrust.loosens("read", "*.env", "allow")).toBe(true)
    expect(ConfigTrust.loosens("read", "src\\.e*v", "allow")).toBe(true)
    expect(ConfigTrust.loosens("read", "src/*", "allow")).toBe(true)
    expect(ConfigTrust.loosens("read", "*v", "allow")).toBe(true)
    expect(ConfigTrust.loosens("read", "deep/er/.e?v", "allow")).toBe(true)
    expect(ConfigTrust.loosens("read", "*.production", "allow")).toBe(true)
  })

  test("keeps rules that don't", () => {
    expect(ConfigTrust.loosens("external_directory", "*", "deny")).toBe(false)
    expect(ConfigTrust.loosens("read", "*.env", "ask")).toBe(false)
    expect(ConfigTrust.loosens("read", "src/*.ts", "allow")).toBe(false)
    expect(ConfigTrust.loosens("bash", "*", "allow")).toBe(false)
  })

  test("keeps only instructions that stay in the folder", () => {
    expect(ConfigTrust.localInstruction("docs/guide.md")).toBe(true)
    expect(ConfigTrust.localInstruction("https://example.com/guide.md")).toBe(true)
    expect(ConfigTrust.localInstruction("~/.ssh/id_rsa")).toBe(false)
    expect(ConfigTrust.localInstruction("/etc/passwd")).toBe(false)
    expect(ConfigTrust.localInstruction("C:\\Users\\me\\secret.txt")).toBe(false)
    expect(ConfigTrust.localInstruction("../secret.txt")).toBe(false)
  })
})
