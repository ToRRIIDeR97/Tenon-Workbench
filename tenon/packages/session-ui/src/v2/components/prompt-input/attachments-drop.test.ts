import { describe, expect, test } from "bun:test"
import { folderMention, sortDrop } from "./attachments"

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
