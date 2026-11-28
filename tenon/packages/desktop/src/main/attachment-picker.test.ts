import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createPickedFileAuthorizations,
  MAX_ATTACHMENT_BYTES,
  planAttachments,
  readAttachment,
} from "./attachment-picker"

describe("planAttachments", () => {
  test("reads every file of a selection within the media ingest limit", () => {
    expect(
      planAttachments([{ size: MAX_ATTACHMENT_BYTES / 2 }, { size: MAX_ATTACHMENT_BYTES / 2 }]).map(
        (file) => file.inline,
      ),
    ).toEqual([true, true])
  })

  test("a file over the limit is attached by location and the others are still read", () => {
    const plan = planAttachments([
      { name: "notes.md", size: 10 },
      { name: "recording.mp4", size: MAX_ATTACHMENT_BYTES * 250 },
      { name: "shot.png", size: 20 },
    ])
    expect(plan.map((file) => [file.name, file.inline])).toEqual([
      ["notes.md", true],
      ["recording.mp4", false],
      ["shot.png", true],
    ])
  })

  test("files are read in order until the shared budget runs out", () => {
    expect(planAttachments([{ size: 6 }, { size: 6 }, { size: 4 }], 10).map((file) => file.inline)).toEqual([
      true,
      false,
      true,
    ])
  })

  test("reads an approved file through a bounded buffer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-attachment-"))
    const file = join(directory, "example.txt")
    try {
      await writeFile(file, "lorem ipsum")
      expect(new TextDecoder().decode(await readAttachment(file))).toBe("lorem ipsum")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rejects an oversized file before allocating its contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-attachment-"))
    const file = join(directory, "oversized.txt")
    try {
      await writeFile(file, "")
      await truncate(file, MAX_ATTACHMENT_BYTES + 1)
      await expect(readAttachment(file)).rejects.toThrow("20 MB limit")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("picked file authorizations", () => {
  const read = async (path: string) => new TextEncoder().encode(path).buffer

  test("keeps concurrent picker selections isolated", async () => {
    const authorizations = createPickedFileAuthorizations(read)
    const first = authorizations.add(1, ["a.txt", "b.txt"])
    const second = authorizations.add(1, ["c.txt"])

    expect(new TextDecoder().decode(await authorizations.read(1, first, "a.txt"))).toBe("a.txt")
    expect(new TextDecoder().decode(await authorizations.read(1, second, "c.txt"))).toBe("c.txt")
    expect(new TextDecoder().decode(await authorizations.read(1, first, "b.txt"))).toBe("b.txt")
  })

  test("releases unread files for one picker without affecting another", async () => {
    const authorizations = createPickedFileAuthorizations(read)
    const first = authorizations.add(1, ["a.txt"])
    const second = authorizations.add(1, ["b.txt"])
    authorizations.release(1, first)

    await expect(authorizations.read(1, first, "a.txt")).rejects.toThrow("not selected")
    expect(new TextDecoder().decode(await authorizations.read(1, second, "b.txt"))).toBe("b.txt")
  })

  test("keeps picker tokens scoped to their renderer", async () => {
    const authorizations = createPickedFileAuthorizations(read)
    const token = authorizations.add(1, ["a.txt"])

    await expect(authorizations.read(2, token, "a.txt")).rejects.toThrow("not selected")
  })

  test("charges actual reads against the selection budget", async () => {
    const authorizations = createPickedFileAuthorizations(async (_path, maxBytes) => {
      if (6 > maxBytes) throw new Error("budget exceeded")
      return new ArrayBuffer(6)
    }, 10)
    const token = authorizations.add(1, ["a.txt", "b.txt"])

    await authorizations.read(1, token, "a.txt")
    await expect(authorizations.read(1, token, "b.txt")).rejects.toThrow("budget exceeded")
  })
})
