import { describe, expect, test } from "bun:test"
import path from "node:path"
import { workspaceRelative } from "./step-path"

describe("workspaceRelative", () => {
  test("windows paths drop the workspace prefix, whatever the case or separator", () => {
    const root = path.win32.join("C:\\", "Users", "me", "workspace")
    expect(workspaceRelative(path.win32.join(root, "src", "math.ts"), root)).toBe("src\\math.ts")
    expect(workspaceRelative("c:/users/me/workspace/src/math.ts", root)).toBe("src/math.ts")
    expect(workspaceRelative(root, root)).toBe(".")
    expect(workspaceRelative(`${root}2\\a.ts`, root)).toBe(`${root}2\\a.ts`)
    expect(workspaceRelative("D:\\other\\a.ts", root)).toBe("D:\\other\\a.ts")
  })

  test("windows commands shorten the paths they contain", () => {
    const root = "C:\\Users\\me\\workspace"
    expect(workspaceRelative(`type "${root}\\a.txt"`, root)).toBe('type "a.txt"')
    expect(workspaceRelative(`cd ${root} && dir`, root)).toBe("cd . && dir")
  })

  test("posix paths are case-sensitive", () => {
    const root = path.posix.join("/home", "me", "ws") + "/"
    expect(workspaceRelative("/home/me/ws/src/a.ts", root)).toBe("src/a.ts")
    expect(workspaceRelative("/home/me/WS/src/a.ts", root)).toBe("/home/me/WS/src/a.ts")
    expect(workspaceRelative("/x/home/me/ws/a.ts", root)).toBe("/x/home/me/ws/a.ts")
    expect(workspaceRelative("src/a.ts", root)).toBe("src/a.ts")
  })

  test("UNC roots and empty roots", () => {
    expect(workspaceRelative("\\\\server\\share\\ws\\a.ts", "\\\\server\\share\\ws")).toBe("a.ts")
    expect(workspaceRelative("/a.ts", "/")).toBe("/a.ts")
    expect(workspaceRelative("a.ts", undefined)).toBe("a.ts")
  })
})
