import { describe, expect, test } from "bun:test"
import { currentProject } from "./prompt-project-selector"

const general = { worktree: "/brain", name: "General" }
const shared = { worktree: "/brain", name: "Lmao", id: "prj_lmao" }
const own = { worktree: "/brain/projects/hw", name: "HW Finder", id: "prj_hw" }
const available = [general, own, shared]

describe("currentProject", () => {
  test("picks General in the workspace folder when the draft has no Project", () => {
    expect(currentProject({ available, directory: "/brain" })).toBe(general)
  })

  test("picks the draft's Project when it shares General's folder", () => {
    expect(currentProject({ available, directory: "/brain", projectID: "prj_lmao" })).toBe(shared)
  })

  test("picks a Project by its own thread folder", () => {
    expect(currentProject({ available, directory: "/brain/projects/hw" })).toBe(own)
  })
})
