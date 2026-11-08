import type { Clipboard, NativeImage } from "electron"

export type ClipboardImage = { buffer: ArrayBuffer; width: number; height: number }

type Deps = {
  clipboard: Pick<Clipboard, "read">
  createFromBuffer: (buffer: Buffer) => NativeImage
}

const PNG = "image/png"

// Electron 44 replaced `clipboard.readImage()` with the W3C-style `clipboard.read()`. The renderer always
// receives PNG bytes, as before: a PNG entry is passed through, any other image type is re-encoded.
export async function readClipboardImage(deps: Deps): Promise<ClipboardImage | null> {
  const items = await deps.clipboard.read()
  const item =
    items.find((entry) => entry.types.includes(PNG)) ??
    items.find((entry) => entry.types.some((type) => type.startsWith("image/")))
  if (!item) return null
  const type = item.types.includes(PNG) ? PNG : item.types.find((entry) => entry.startsWith("image/"))!
  const bytes = await ((await item.getType(type)) as Blob).arrayBuffer()
  const image = deps.createFromBuffer(Buffer.from(bytes))
  if (image.isEmpty()) return null
  const size = image.getSize()
  if (type === PNG) return { buffer: bytes, width: size.width, height: size.height }
  const png = image.toPNG()
  const buffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer
  return { buffer, width: size.width, height: size.height }
}
