import { describe, expect, test } from "bun:test"
import { acceptedAttachments, attachmentMime } from "./attachments"

describe("AC-17 the composer accepts video, audio and documents", () => {
  test("each file keeps its own type", async () => {
    expect(await attachmentMime(new File(["x"], "recording.mov", { type: "video/quicktime" }))).toBe("video/quicktime")
    expect(await attachmentMime(new File([new Uint8Array([0, 1, 2])], "memo.m4a", { type: "" }))).toBe("audio/mp4")
    expect(await attachmentMime(new File([new Uint8Array([0x50, 0x4b, 3, 4, 0])], "Q3.pptx", { type: "" }))).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )
    expect(await attachmentMime(new File([new Uint8Array([0x50, 0x4b, 0])], "notes.docx", { type: "" }))).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    expect(await attachmentMime(new File(["x"], "song.mp3", { type: "audio/mpeg" }))).toBe("audio/mpeg")
  })

  test("unknown binary data is still refused", async () => {
    expect(await attachmentMime(new File([new Uint8Array([0, 0, 0])], "blob.bin", { type: "" }))).toBeUndefined()
  })

  test("the file picker offers the new formats", () => {
    for (const item of ["video/*", "audio/*", ".docx", ".pptx", ".xlsx", ".odt", ".rtf", ".epub", ".mkv", ".flac"])
      expect(acceptedAttachments).toContain(item)
  })
})
