import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { computerUseNotice, installCommand } from "./project-computer-use-model"

describe("AC-22 the Project's computer use card", () => {
  test("a missing driver shows how to install it, for the platform", () => {
    expect(computerUseNotice({ enabled: true, installed: false, permissions: "unknown", platform: "win32" })).toBe(
      "install",
    )
    expect(installCommand("win32")).toBe("irm https://cua.ai/driver/install.ps1 | iex")
    expect(installCommand("darwin")).toBe('/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"')
  })

  test("macOS without its grants says to grant them", () => {
    expect(computerUseNotice({ enabled: true, installed: true, permissions: "missing", platform: "darwin" })).toBe(
      "permissions",
    )
  })

  test("on and ready, or off, needs nothing", () => {
    expect(computerUseNotice({ enabled: true, installed: true, permissions: "granted", platform: "darwin" })).toBe(
      undefined,
    )
    expect(computerUseNotice({ enabled: false, installed: false, permissions: "unknown", platform: "win32" })).toBe(
      undefined,
    )
  })

  test("the Project page shows the card", () => {
    const source = readFileSync(join(import.meta.dir, "project-view.tsx"), "utf8")
    expect(source).toContain("ProjectComputerUse")
  })
})
