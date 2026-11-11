import { describe, expect, test } from "bun:test"
import { acceptKey, directoryAcceptKey, modeAllows, permissionMode } from "./permission-auto-respond"

describe("permission modes", () => {
  const sessions = [{ id: "ses_child", parentID: "ses_main" }, { id: "ses_main" }]

  test("full auto allows everything inside the folder but asks for outside folders", () => {
    expect(modeAllows("full", { permission: "bash" })).toBe(true)
    expect(modeAllows("full", { permission: "edit" })).toBe(true)
    expect(modeAllows("full", { permission: "external_directory" })).toBe(false)
  })

  test("auto-edit allows only file edits", () => {
    expect(modeAllows("edit", { permission: "edit" })).toBe(true)
    expect(modeAllows("edit", { permission: "bash" })).toBe(false)
    expect(modeAllows("ask", { permission: "edit" })).toBe(false)
  })

  test("a subagent inherits its thread's mode, and the folder mode is the fallback", () => {
    const full = { [acceptKey("ses_main", "/dir")]: true }
    expect(permissionMode({ full, edit: {} }, sessions, "ses_child", "/dir")).toBe("full")
    expect(permissionMode({ full: {}, edit: { [directoryAcceptKey("/dir")]: true } }, sessions, "ses_child", "/dir")).toBe("edit")
    expect(permissionMode({ full: {}, edit: {} }, sessions, "ses_child", "/dir")).toBe("ask")
  })
})
