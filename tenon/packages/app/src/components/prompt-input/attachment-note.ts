import { createStore } from "solid-js/store"
import { documentKind, frameTimes, mediaPlan, slideCount, type ModelInputs } from "./attachment-media"
import { mediaDuration } from "./attachment-prepare"

export type NoteDetails = { seconds?: number; slides?: number }
type Key =
  | "secondBrain.attachment.videoFile"
  | "secondBrain.attachment.videoFrames"
  | "secondBrain.attachment.videoFramesTranscript"
  | "secondBrain.attachment.audioFile"
  | "secondBrain.attachment.audioTranscript"
  | "secondBrain.attachment.audioLength"
  | "secondBrain.attachment.slides"
  | "secondBrain.attachment.text"
  | "secondBrain.attachment.nameOnly"

const clock = (seconds: number | undefined) =>
  seconds === undefined ? "…" : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`

export function attachmentNote(
  mime: string,
  inputs: ModelInputs,
  details: NoteDetails | undefined,
  transcribes: boolean,
): { key: Key; params: Record<string, string | number> } | undefined {
  const plan = mediaPlan(mime, inputs)
  const length = clock(details?.seconds)
  if (mime.startsWith("video/")) {
    if (plan === "file") return { key: "secondBrain.attachment.videoFile", params: { length } }
    if (plan === "frames") {
      const frames = details?.seconds === undefined ? "…" : frameTimes(details.seconds).grids.flat().length
      return {
        key: transcribes ? "secondBrain.attachment.videoFramesTranscript" : "secondBrain.attachment.videoFrames",
        params: { length, frames },
      }
    }
    return { key: "secondBrain.attachment.nameOnly", params: {} }
  }
  if (mime.startsWith("audio/")) {
    if (plan === "file") return { key: "secondBrain.attachment.audioFile", params: { length } }
    return {
      key: transcribes ? "secondBrain.attachment.audioTranscript" : "secondBrain.attachment.audioLength",
      params: { length },
    }
  }
  if (plan === "text")
    return details?.slides
      ? { key: "secondBrain.attachment.slides", params: { count: details.slides } }
      : { key: "secondBrain.attachment.text", params: {} }
  if (plan === "standIn") return { key: "secondBrain.attachment.nameOnly", params: {} }
  return undefined
}

export function createNoteDetails() {
  const [details, setDetails] = createStore<Record<string, NoteDetails>>({})
  const started = new Set<string>()
  return {
    get: (id: string) => details[id],
    load(attachment: { id: string; mime: string; blob: { url: string } }) {
      if (started.has(attachment.id)) return
      const media = attachment.mime.startsWith("video/") || attachment.mime.startsWith("audio/")
      const deck = documentKind(attachment.mime) === "pptx" || documentKind(attachment.mime) === "odp"
      if (!media && !deck) return
      started.add(attachment.id)
      void fetch(attachment.blob.url)
        .then((response) => response.blob())
        .then(async (blob) =>
          media
            ? { seconds: await mediaDuration(blob, attachment.mime) }
            : { slides: slideCount(new Uint8Array(await blob.arrayBuffer())) },
        )
        .then((value) => setDetails(attachment.id, value))
        .catch(() => undefined)
    },
  }
}
