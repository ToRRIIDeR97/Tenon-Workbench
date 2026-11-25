import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { documentText, frameTimes, mediaPlan, rtfText } from "./attachment-media"

const imageOnly = { image: true, video: false, audio: false, pdf: true }

describe("AC-17 what is sent for each kind", () => {
  test("a model with the input gets the file itself", () => {
    expect(mediaPlan("video/mp4", { ...imageOnly, video: true })).toBe("file")
    expect(mediaPlan("audio/mpeg", { ...imageOnly, audio: true })).toBe("file")
    expect(mediaPlan("image/png", imageOnly)).toBe("file")
    expect(mediaPlan("application/pdf", imageOnly)).toBe("file")
  })

  test("a video for an image-only model becomes frame grids; with no image input a stand-in", () => {
    expect(mediaPlan("video/quicktime", imageOnly)).toBe("frames")
    expect(mediaPlan("video/mp4", { image: false, video: false, audio: false, pdf: false })).toBe("standIn")
  })

  test("audio a model can't listen to becomes a stand-in", () => {
    expect(mediaPlan("audio/wav", imageOnly)).toBe("standIn")
  })

  test("office, OpenDocument, RTF and EPUB files are sent as their text; legacy Office files as a stand-in", () => {
    for (const mime of [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.text",
      "application/rtf",
      "application/epub+zip",
    ])
      expect(mediaPlan(mime, imageOnly)).toBe("text")
    expect(mediaPlan("application/msword", imageOnly)).toBe("standIn")
  })
})

describe("AC-17 frames by length", () => {
  test("up to 15 s: one 2×2 grid", () => {
    expect(frameTimes(12)).toEqual({ columns: 2, grids: [[1.5, 4.5, 7.5, 10.5]] })
  })

  test("up to a minute: one 3×3 grid; up to 5 minutes: two; longer: four at most", () => {
    expect(frameTimes(45).grids.map((grid) => grid.length)).toEqual([9])
    expect(frameTimes(45).columns).toBe(3)
    expect(frameTimes(112).grids.map((grid) => grid.length)).toEqual([9, 9])
    expect(frameTimes(3600).grids.map((grid) => grid.length)).toEqual([9, 9, 9, 9])
    const all = frameTimes(112).grids.flat()
    expect(all.every((time, index) => index === 0 || time > all[index - 1]!)).toBe(true)
    expect(all.at(-1)!).toBeLessThan(112)
  })
})

function zip(files: Record<string, string>) {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(text)
    const local = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint32(18, data.length, true)
    view.setUint32(22, data.length, true)
    view.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    const entry = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(entry.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    entry.set(nameBytes, 46)
    chunks.push(local, data)
    central.push(entry)
    offset += local.length + data.length
  }
  const size = central.reduce((sum, item) => sum + item.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, central.length, true)
  endView.setUint16(10, central.length, true)
  endView.setUint32(12, size, true)
  endView.setUint32(16, offset, true)
  const all = [...chunks, ...central, end]
  const out = new Uint8Array(all.reduce((sum, item) => sum + item.length, 0))
  let at = 0
  for (const item of all) {
    out.set(item, at)
    at += item.length
  }
  return out
}

describe("AC-17 document text", () => {
  test("a Word document's paragraphs", async () => {
    const bytes = zip({
      "word/document.xml":
        '<w:document><w:body><w:p><w:r><w:t>Q3 review</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Revenue &amp; costs</w:t></w:r></w:p></w:body></w:document>',
    })
    expect(await documentText(bytes, "docx")).toBe("Q3 review\nRevenue & costs")
  })

  test("a PowerPoint's slides in order", async () => {
    const bytes = zip({
      "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide10.xml": "<p:sld><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>",
    })
    expect(await documentText(bytes, "pptx")).toBe("Slide 1\nFirst\n\nSlide 2\nSecond\n\nSlide 10\nTenth")
  })

  test("an OpenDocument text", async () => {
    const bytes = zip({ "content.xml": "<office:body><text:p>Hello</text:p><text:p>World</text:p></office:body>" })
    expect(await documentText(bytes, "odt")).toBe("Hello\nWorld")
  })

  test("RTF control words are dropped", () => {
    expect(rtfText("{\\rtf1\\ansi{\\fonttbl\\f0 Arial;}\\f0\\fs24 Hello \\b world\\b0\\par Next}")).toBe(
      "Hello world\nNext",
    )
  })

  test("submit prepares attachments before encoding them", () => {
    const source = readFileSync(join(import.meta.dir, "submit.ts"), "utf8")
    expect(source).toContain("prepareAttachments(")
  })
})
