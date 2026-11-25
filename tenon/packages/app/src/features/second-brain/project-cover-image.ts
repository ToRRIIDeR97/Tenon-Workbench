export const COVER_MAX_WIDTH = 2400
export const COVER_MAX_BYTES = 6 * 1024 * 1024
const coverTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"]

export function coverSize(width: number, height: number, max = COVER_MAX_WIDTH) {
  if (width <= max) return { width, height }
  return { width: max, height: Math.max(1, Math.round((height * max) / width)) }
}

export function acceptsCover(file: Pick<File, "type" | "size">) {
  return coverTypes.includes(file.type) && file.size > 0
}

export async function coverDataUrl(file: File) {
  if (!acceptsCover(file)) throw new Error("unsupported_cover")
  const bitmap = await createImageBitmap(file)
  const size = coverSize(bitmap.width, bitmap.height)
  if (file.size <= COVER_MAX_BYTES && size.width === bitmap.width && file.type !== "image/gif") {
    bitmap.close()
    return readDataUrl(file)
  }
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()
  const dataUrl = canvas.toDataURL("image/webp", 0.86)
  if (!dataUrl.startsWith("data:image/webp;")) return canvas.toDataURL("image/jpeg", 0.86)
  return dataUrl
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
