import { describe, expect, test } from "bun:test"
import { folderKey, togglePinned } from "./artifacts"

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
})
