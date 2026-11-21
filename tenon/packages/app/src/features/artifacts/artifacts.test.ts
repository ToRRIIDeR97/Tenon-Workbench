import { describe, expect, test } from "bun:test"
import {
  absoluteFrom,
  artifactAt,
  artifactsPage,
  folderKey,
  projectFor,
  readArtifacts,
  rebase,
  togglePinned,
} from "./artifacts"

describe("artifacts", () => {
  test("pinning adds a file newest first and pinning it again removes it", () => {
    const one = togglePinned([], { src: "art/rifle.glb", name: "rifle.glb", kind: "model" }, 1)
    const two = togglePinned(one, { src: "audio/shot.wav", name: "shot.wav", kind: "audio" }, 2)
    expect(two.map((item) => item.path)).toEqual(["audio/shot.wav", "art/rifle.glb"])
    expect(
      togglePinned(two, { src: "art/rifle.glb", name: "rifle.glb", kind: "model" }, 3).map((item) => item.path),
    ).toEqual(["audio/shot.wav"])
  })

  test("a Project's folder is one key however its path is written", () => {
    expect(folderKey("C:\\Users\\me\\Brain\\projects\\Alpha\\")).toBe(folderKey("c:/users/me/brain/projects/Alpha"))
    expect(folderKey("/home/me/Brain/projects/Alpha/")).toBe("/home/me/Brain/projects/Alpha")
  })

  test("a folder belongs to the Project whose thread folder holds it, the innermost first", () => {
    const projects = [
      { id: "brain", name: "Brain", directory: "C:/Users/me/Brain" },
      { id: "alpha", name: "Alpha X", directory: "C:/Users/me/Brain/projects/Alpha X" },
    ]
    expect(projectFor(projects, "c:/users/me/brain/projects/alpha x/.worktrees/m5")?.id).toBe("alpha")
    expect(projectFor(projects, "C:/Users/me/Brain/notes")?.id).toBe("brain")
    expect(projectFor(projects, "D:/elsewhere")).toBeUndefined()
    expect(projectFor(projects, "C:/Users/me/Brain/projects/Alpha XY")?.id).toBe("brain")
  })

  test("a path from a worktree is kept relative to the Project's folder, in its own spelling", () => {
    expect(rebase("C:/Work/Alpha/.worktrees/m5", "art/Rifle.glb", "c:/work/alpha")).toBe(".worktrees/m5/art/Rifle.glb")
    expect(rebase("/home/me/alpha", "art/rifle.glb", "/home/me/alpha")).toBe("art/rifle.glb")
    expect(rebase("/home/me/other", "a.png", "/home/me/alpha")).toBe("a.png")
  })

  test("the Artifacts page lists the files for people and agents and keeps their paths in its properties", () => {
    const items = [{ path: "art/rifle.glb", name: "rifle.glb", kind: "model" as const, pinnedAt: 0 }]
    expect(artifactsPage(items)).toContain("- rifle.glb — `art/rifle.glb`")
    expect(readArtifacts({ tenon: "artifacts", artifacts: ["art/rifle.glb", "audio/shot.wav"] })).toEqual([
      items[0],
      { path: "audio/shot.wav", name: "shot.wav", kind: "audio", pinnedAt: 0 },
    ])
    expect(readArtifacts({ artifacts: [3, "", { path: "a.png" }, "a.png"] })).toEqual([artifactAt("a.png")])
    expect(readArtifacts(undefined)).toEqual([])
  })

  test("a path relative to the thread's folder becomes absolute, .. included", () => {
    expect(absoluteFrom("C:/Users/me/Tenon/.command-centre", "../../Brain/projects/Alpha/art/x.png")).toBe(
      "C:/Users/me/Brain/projects/Alpha/art/x.png",
    )
    expect(absoluteFrom("/home/me/vault/.command-centre", "./notes/a.md")).toBe(
      "/home/me/vault/.command-centre/notes/a.md",
    )
    expect(absoluteFrom("/home/me", "/srv/a.png")).toBe("/srv/a.png")
    expect(absoluteFrom("C:\\Work", "D:\\art\\a.png")).toBe("D:/art/a.png")
  })
})
