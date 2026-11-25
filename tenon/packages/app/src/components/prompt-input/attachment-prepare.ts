import type { ImageAttachmentPart } from "@/context/prompt"
import { createBlobReference } from "@/utils/draft-store"
import { uuid } from "@/utils/uuid"
import {
  DEFAULT_INPUTS,
  documentKind,
  documentText,
  frameTimes,
  mediaPlan,
  rtfText,
  type ModelInputs,
} from "./attachment-media"

let transcriber: ((samples: Float32Array) => Promise<{ text?: string }>) | undefined
let notify: ((event: { kind: "transcribing" | "transcribeFailed"; filename: string }) => void) | undefined
export function setAttachmentTranscriber(fn: typeof transcriber, onEvent?: typeof notify) {
  transcriber = fn
  notify = onEvent
}

const MAX_TRANSCRIBE_SAMPLES = 30 * 60 * 16_000
const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000

const FRAME_WIDTH = 480

export async function prepareAttachments(attachments: ImageAttachmentPart[], inputs: ModelInputs = DEFAULT_INPUTS) {
  const prepared = await Promise.all(attachments.map((attachment) => prepare(attachment, inputs)))
  return prepared.flat()
}

async function prepare(attachment: ImageAttachmentPart, inputs: ModelInputs): Promise<ImageAttachmentPart[]> {
  const plan = mediaPlan(attachment.mime, inputs)
  if (plan === "file") return [attachment]
  const blob = await fetch(attachment.blob.url).then((response) => response.blob())
  if (plan === "text") {
    const text = await extract(blob, attachment.mime).catch(() => "")
    return [await textPart(attachment, text ? `${attachment.filename}:\n${text}` : standIn(attachment, undefined))]
  }
  if (plan === "frames") {
    const grids = await frameGrids(blob).catch(() => undefined)
    if (grids && grids.length > 0) {
      const spoken = await transcript(blob, attachment.filename)
      const images = await Promise.all(
        grids.map(async (grid, index) => ({
          type: "image" as const,
          id: uuid(),
          filename: `${attachment.filename} · frames ${index + 1} of ${grids.length}.png`,
          mime: "image/png",
          blob: await createBlobReference(grid),
        })),
      )
      return spoken
        ? [...images, await textPart(attachment, `Audio transcript of ${attachment.filename}:\n${spoken}`)]
        : images
    }
  }
  const seconds = await mediaDuration(blob, attachment.mime).catch(() => undefined)
  const spoken = attachment.mime.startsWith("audio/") ? await transcript(blob, attachment.filename) : undefined
  if (spoken)
    return [
      await textPart(
        attachment,
        `Transcript of ${attachment.filename}${seconds === undefined ? "" : ` (${length(seconds)})`}:\n${spoken}`,
      ),
    ]
  return [await textPart(attachment, standIn(attachment, seconds))]
}

async function extract(blob: Blob, mime: string) {
  if (mime === "application/rtf" || mime === "text/rtf") return rtfText(await blob.text())
  const kind = documentKind(mime)
  return kind ? documentText(new Uint8Array(await blob.arrayBuffer()), kind) : ""
}

const length = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`

function standIn(attachment: ImageAttachmentPart, seconds: number | undefined) {
  const duration = seconds === undefined ? "" : `, ${length(seconds)} long`
  return `[Attached ${attachment.filename} (${attachment.mime}${duration}). This model can't read this kind of file, so only its name was sent.]`
}

async function textPart(attachment: ImageAttachmentPart, text: string): Promise<ImageAttachmentPart> {
  return {
    type: "image",
    id: uuid(),
    filename: `${attachment.filename}.txt`,
    mime: "text/plain",
    blob: await createBlobReference(new Blob([text], { type: "text/plain" })),
  }
}

async function transcript(blob: Blob, filename: string) {
  const engine = transcriber
  if (!engine) return undefined
  const samples = await samples16k(blob).catch(() => undefined)
  if (!samples || samples.length === 0) return undefined
  if (samples.length > MAX_TRANSCRIBE_SAMPLES) {
    notify?.({ kind: "transcribeFailed", filename })
    return undefined
  }
  notify?.({ kind: "transcribing", filename })
  const result = await Promise.race([
    engine(samples).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), TRANSCRIBE_TIMEOUT_MS)),
  ])
  const text = result?.text?.trim()
  if (!text) notify?.({ kind: "transcribeFailed", filename })
  return text || undefined
}

async function samples16k(blob: Blob) {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16_000), 16_000)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    return (await offline.startRendering()).getChannelData(0)
  } finally {
    void context.close()
  }
}

export function mediaDuration(blob: Blob, mime: string) {
  return new Promise<number>((resolve, reject) => {
    const element = document.createElement(mime.startsWith("video/") ? "video" : "audio")
    const url = URL.createObjectURL(blob)
    element.preload = "metadata"
    element.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      Number.isFinite(element.duration) ? resolve(element.duration) : reject(new Error("no duration"))
    }
    element.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("unreadable media"))
    }
    element.src = url
  })
}

export async function frameGrids(blob: Blob) {
  const video = document.createElement("video")
  const url = URL.createObjectURL(blob)
  video.muted = true
  video.preload = "auto"
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error("unreadable video"))
    })
    const plan = frameTimes(video.duration)
    const height = Math.round((FRAME_WIDTH * video.videoHeight) / Math.max(1, video.videoWidth))
    const grids: Blob[] = []
    for (const times of plan.grids) {
      const rows = Math.ceil(times.length / plan.columns)
      const canvas = document.createElement("canvas")
      canvas.width = FRAME_WIDTH * plan.columns
      canvas.height = height * rows
      const context = canvas.getContext("2d")
      if (!context) throw new Error("no canvas")
      for (const [index, time] of times.entries()) {
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
          video.currentTime = Math.min(time, Math.max(0, video.duration - 0.05))
        })
        const x = (index % plan.columns) * FRAME_WIDTH
        const y = Math.floor(index / plan.columns) * height
        context.drawImage(video, x, y, FRAME_WIDTH, height)
        context.fillStyle = "rgb(0 0 0 / 0.6)"
        context.fillRect(x + 6, y + 6, 54, 20)
        context.fillStyle = "#fff"
        context.font = "13px sans-serif"
        context.fillText(length(time), x + 12, y + 21)
      }
      grids.push(
        await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("no image"))), "image/png"),
        ),
      )
    }
    return grids
  } finally {
    URL.revokeObjectURL(url)
  }
}
