import { describe, expect, test } from "bun:test"
import type { ClipboardItem, NativeImage } from "electron"
import { readClipboardImage } from "./clipboard-image"

const item = (entries: Record<string, Uint8Array>) =>
  ({
    types: Object.keys(entries),
    getType: async (type: string) => new Blob([entries[type]!], { type }),
  }) as unknown as ClipboardItem

const fakeImage = (input: { empty?: boolean; png?: Uint8Array; width?: number; height?: number }) =>
  ({
    isEmpty: () => input.empty ?? false,
    getSize: () => ({ width: input.width ?? 0, height: input.height ?? 0 }),
    toPNG: () => Buffer.from(input.png ?? []),
  }) as unknown as NativeImage

const read = (items: ClipboardItem[], image: NativeImage, seen: Buffer[] = []) =>
  readClipboardImage({
    clipboard: { read: async () => items },
    createFromBuffer: (buffer) => {
      seen.push(buffer)
      return image
    },
  })

describe("readClipboardImage", () => {
  test("returns null when the clipboard holds no image", async () => {
    expect(await read([item({ "text/plain": new TextEncoder().encode("hi") })], fakeImage({}))).toBeNull()
    expect(await read([], fakeImage({}))).toBeNull()
  })

  test("returns null when the image cannot be decoded", async () => {
    expect(await read([item({ "image/png": new Uint8Array([1]) })], fakeImage({ empty: true }))).toBeNull()
  })

  test("passes PNG bytes through with the decoded size", async () => {
    const png = new Uint8Array([137, 80, 78, 71])
    const seen: Buffer[] = []
    const result = await read(
      [item({ "text/plain": new Uint8Array([1]), "image/png": png })],
      fakeImage({ width: 3, height: 2 }),
      seen,
    )
    expect(result).toEqual({ buffer: png.buffer, width: 3, height: 2 })
    expect([...seen[0]!]).toEqual([...png])
  })

  test("re-encodes other image types as PNG", async () => {
    const result = await read(
      [item({ "image/jpeg": new Uint8Array([255, 216]) })],
      fakeImage({ png: new Uint8Array([9, 8, 7]), width: 4, height: 5 }),
    )
    expect(result?.width).toBe(4)
    expect(result?.height).toBe(5)
    expect([...new Uint8Array(result!.buffer)]).toEqual([9, 8, 7])
  })
})
