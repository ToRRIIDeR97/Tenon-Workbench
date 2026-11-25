export type ModelInputs = { image: boolean; video: boolean; audio: boolean; pdf: boolean }
export type MediaPlan = "file" | "frames" | "standIn" | "text"
export type DocumentKind = "docx" | "pptx" | "xlsx" | "odt" | "odp" | "ods" | "epub"

export const DEFAULT_INPUTS: ModelInputs = { image: true, video: false, audio: false, pdf: true }

const DOCUMENTS: Record<string, DocumentKind> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/epub+zip": "epub",
}
const LEGACY = new Set(["application/msword", "application/vnd.ms-powerpoint", "application/vnd.ms-excel"])

export const documentKind = (mime: string): DocumentKind | undefined => DOCUMENTS[mime]

export function mediaPlan(mime: string, inputs: ModelInputs): MediaPlan {
  if (mime.startsWith("video/")) return inputs.video ? "file" : inputs.image ? "frames" : "standIn"
  if (mime.startsWith("audio/")) return inputs.audio ? "file" : "standIn"
  if (mime === "application/pdf") return inputs.pdf ? "file" : "standIn"
  if (DOCUMENTS[mime] || mime === "application/rtf" || mime === "text/rtf") return "text"
  if (LEGACY.has(mime)) return "standIn"
  return "file"
}

export function frameTimes(duration: number) {
  const { grids, perGrid, columns } =
    duration <= 15
      ? { grids: 1, perGrid: 4, columns: 2 }
      : duration <= 60
        ? { grids: 1, perGrid: 9, columns: 3 }
        : duration <= 300
          ? { grids: 2, perGrid: 9, columns: 3 }
          : { grids: 4, perGrid: 9, columns: 3 }
  const total = grids * perGrid
  const times = Array.from({ length: total }, (_, index) => Math.round(((index + 0.5) * duration * 10) / total) / 10)
  return {
    columns,
    grids: Array.from({ length: grids }, (_, grid) => times.slice(grid * perGrid, (grid + 1) * perGrid)),
  }
}

export async function documentText(bytes: Uint8Array, kind: DocumentKind) {
  const entries = readZip(bytes)
  const read = (name: string) => (entries.has(name) ? inflate(bytes, entries.get(name)!) : Promise.resolve(""))
  if (kind === "docx") return paragraphs(await read("word/document.xml"), "w:p", "w:t")
  if (kind === "pptx") {
    const slides = [...entries.keys()]
      .flatMap((name) => {
        const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name)
        return match ? [{ name, number: Number(match[1]) }] : []
      })
      .toSorted((a, b) => a.number - b.number)
    const texts = await Promise.all(slides.map(async (slide) => paragraphs(await read(slide.name), "a:p", "a:t")))
    return slides.map((slide, index) => `Slide ${slide.number}\n${texts[index]}`).join("\n\n")
  }
  if (kind === "xlsx") return runs(await read("xl/sharedStrings.xml"), "t").join("\n")
  if (kind === "epub") {
    const pages = [...entries.keys()].filter((name) => /\.x?html?$/i.test(name)).toSorted()
    return (await Promise.all(pages.map(async (page) => stripTags(await read(page))))).filter(Boolean).join("\n\n")
  }
  return paragraphs(await read("content.xml"), "text:p", undefined)
}

export function slideCount(bytes: Uint8Array) {
  const names = [...readZip(bytes).keys()]
  const pptx = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length
  return pptx || undefined
}

export function rtfText(rtf: string) {
  return rtf
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|\*)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, "")
    .replace(/\\par[d]?\s?/g, "\n")
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
}

type ZipEntry = { offset: number; compressed: number; method: number }

function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = new Map<string, ZipEntry>()
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) return entries
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  for (let index = 0; index < count && at + 46 <= bytes.length; index++) {
    if (view.getUint32(at, true) !== 0x02014b50) break
    const method = view.getUint16(at + 10, true)
    const compressed = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extra = view.getUint16(at + 30, true)
    const comment = view.getUint16(at + 32, true)
    const offset = view.getUint32(at + 42, true)
    entries.set(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)), { offset, compressed, method })
    at += 46 + nameLength + extra + comment
  }
  return entries
}

async function inflate(bytes: Uint8Array, entry: ZipEntry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true)
  const data = bytes.slice(start, start + entry.compressed)
  if (entry.method === 0) return new TextDecoder().decode(data)
  if (entry.method !== 8) return ""
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Response(stream).text()
}

const entities = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")

const escapeTag = (tag: string) => tag.replace(":", "\\:")

function paragraphs(xml: string, paragraph: string, run: string | undefined) {
  const pattern = new RegExp(`<${escapeTag(paragraph)}[\\s>][\\s\\S]*?</${escapeTag(paragraph)}>`, "g")
  return (xml.match(pattern) ?? [])
    .map((block) => (run ? runs(block, run).join("") : stripTags(block)))
    .filter((text) => text.trim().length > 0)
    .join("\n")
}

function runs(xml: string, tag: string) {
  const pattern = new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(tag)}>`, "g")
  return [...xml.matchAll(pattern)].map((match) => entities(match[1] ?? ""))
}

function stripTags(xml: string) {
  return entities(xml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}
