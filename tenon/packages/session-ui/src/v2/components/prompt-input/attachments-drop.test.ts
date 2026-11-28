import { describe, expect, test } from "bun:test"
import {
  folderMention,
  locationNote,
  MAX_INLINE_ATTACHMENT_BYTES,
  referenceFile,
  sizeLabel,
  sortDrop,
} from "./attachments"

const item = (file: File, folder: boolean) =>
  ({
    kind: "file",
    getAsFile: () => file,
    webkitGetAsEntry: () => ({ isDirectory: folder }),
  }) as unknown as DataTransferItem
const transfer = (items: DataTransferItem[], files: File[] = []) => ({ items, files }) as unknown as DataTransfer

describe("dropping a folder onto the composer", () => {
  test("sorts folders from files by their entry, not their (empty) type", () => {
    const folder = new File([], "Wickfall")
    const note = new File(["x"], "plan.md", { type: "text/markdown" })
    const drop = sortDrop(transfer([item(folder, true), item(note, false)]))
    expect(drop.folders).toEqual([folder])
    expect(drop.files).toEqual([note])
  })

  test("falls back to the file list when the drop has no items", () => {
    const note = new File(["x"], "plan.md")
    expect(sortDrop(transfer([], [note]))).toEqual({ folders: [], files: [note] })
    expect(sortDrop(undefined)).toEqual({ folders: [], files: [] })
  })

  test("a folder becomes a directory mention with its full path, or nothing without one", () => {
    const folder = new File([], "Wickfall")
    expect(folderMention(folder, "C:\Games\Wickfall")).toEqual({
      type: "file",
      path: "C:\Games\Wickfall",
      content: "@Wickfall",
      start: 0,
      end: 0,
      mime: "application/x-directory",
      filename: "Wickfall",
    })
    expect(folderMention(folder, undefined)).toBeUndefined()
    expect(folderMention(folder, "")).toBeUndefined()
  })
})

describe("attaching a file that is too large to send", () => {
  const recording = { name: "Recording.mp4", path: "C:\Users\me\Desktop\Recording.mp4", size: 5_130_988_443 }

  test("sizes read in the unit a person would use", () => {
    expect(sizeLabel(512)).toBe("512 bytes")
    expect(sizeLabel(1536)).toBe("1.5 KB")
    expect(sizeLabel(MAX_INLINE_ATTACHMENT_BYTES)).toBe("20.0 MB")
    expect(sizeLabel(recording.size)).toBe("4.8 GB")
    expect(sizeLabel(250 * 1024 ** 3)).toBe("250 GB")
  })

  test("the note gives the agent the name, size and full path, and says the contents are missing", () => {
    const note = locationNote(recording)
    expect(note).toContain("Recording.mp4 (4.8 GB)")
    expect(note).toContain("by location: C:\Users\me\Desktop\Recording.mp4")
    expect(note).toContain("contents are not included")
  })

  test("the attachment is a small text file named after the original", async () => {
    const file = referenceFile(recording)
    expect(file.name).toBe("Recording.mp4 (location).txt")
    expect(file.type.startsWith("text/plain")).toBe(true)
    expect(file.size).toBeLessThan(1024)
    expect(await file.text()).toBe(locationNote(recording))
  })
})
