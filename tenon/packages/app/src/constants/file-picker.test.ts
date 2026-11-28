import { describe, expect, test } from "bun:test"
import { ACCEPTED_FILE_EXTENSIONS, pickerExtensions } from "./file-picker"

describe("pickerExtensions", () => {
  test("no accept list leaves the choice to the caller's default", () => {
    expect(pickerExtensions(undefined)).toBeUndefined()
    expect(pickerExtensions([])).toBeUndefined()
    expect(pickerExtensions(["video/*", "audio/*"])).toBeUndefined()
  })

  test("the composer's media and document types reach the file dialog", () => {
    const extensions = pickerExtensions(["video/*", ".mp4", ".MOV", ".docx", "image/png", "application/pdf", "text/*"])
    expect(extensions).toEqual(expect.arrayContaining(["mp4", "mov", "docx", "png", "pdf", "txt", "md"]))
    expect(extensions).toEqual([...new Set(extensions)].sort())
  })

  test("the old default never offered video", () => {
    expect(ACCEPTED_FILE_EXTENSIONS).not.toContain("mp4")
  })
})
