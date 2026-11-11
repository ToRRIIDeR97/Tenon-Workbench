import { describe, expect, test } from "bun:test"
import { SecondBrainRequestError } from "@/features/second-brain/client"
import { instructionsErrorKey } from "./instructions-error"

// AC-8: the dialog names why AGENTS.md could not be read or saved.
describe("instructionsErrorKey", () => {
  test("maps the server's reasons to their own messages", () => {
    expect(instructionsErrorKey(new SecondBrainRequestError(400, "outside_workspace"))).toBe(
      "secondBrain.instructions.error.outsideFolder",
    )
    expect(instructionsErrorKey(new SecondBrainRequestError(400, "too_large"))).toBe(
      "secondBrain.instructions.error.tooLarge",
    )
    expect(instructionsErrorKey(new SecondBrainRequestError(404))).toBe("secondBrain.instructions.error.folderMissing")
  })

  test("anything else falls back to the generic message", () => {
    expect(instructionsErrorKey(new SecondBrainRequestError(500))).toBe("secondBrain.error.request")
    expect(instructionsErrorKey(new Error("offline"))).toBe("secondBrain.error.request")
  })
})
