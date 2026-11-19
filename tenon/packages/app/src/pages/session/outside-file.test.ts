import { describe, expect, test } from "bun:test"
import { outsideFileLocation, outsideFileURL } from "./outside-file"

describe("a file outside the thread's folder", () => {
  test("is read through its own folder by name", () => {
    expect(outsideFileLocation("D:/notes/plan.md")).toEqual({ folder: "D:/notes", name: "plan.md" })
    expect(outsideFileLocation("C:/plan.md")).toEqual({ folder: "C:/", name: "plan.md" })
    expect(outsideFileLocation("/etc/hosts")).toEqual({ folder: "/etc", name: "hosts" })
    expect(outsideFileLocation("/hosts")).toEqual({ folder: "/", name: "hosts" })
  })

  test("opens in its default app through a file URL", () => {
    expect(outsideFileURL("D:/my notes/plan.md")).toBe("file:///D:/my%20notes/plan.md")
    expect(outsideFileURL("/etc/hosts")).toBe("file:///etc/hosts")
  })
})
