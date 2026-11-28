import { onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { PromptInputV2Attachment, PromptInputV2Prompt } from "./types"

const FOLDER_MIME = "application/x-directory"

export const MAX_INLINE_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type AttachmentReference = { name: string; path: string; size: number }

export function sizeLabel(bytes: number) {
  const units = ["bytes", "KB", "MB", "GB", "TB"]
  const power = Math.min(units.length - 1, bytes < 1024 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** power
  return `${power === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[power]}`
}

export function locationNote(reference: AttachmentReference) {
  return `[Attached ${reference.name} (${sizeLabel(reference.size)}) by location: ${reference.path}
It is too large to send, so its contents are not included. Read or process it from that path with your tools if you need what is inside.]`
}

export function referenceFile(reference: AttachmentReference) {
  return new File([locationNote(reference)], `${reference.name} (location).txt`, { type: "text/plain" })
}

const mediaExtensions = new Map([
  ["mp4", "video/mp4"],
  ["m4v", "video/x-m4v"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
  ["mkv", "video/x-matroska"],
  ["avi", "video/x-msvideo"],
  ["ogv", "video/ogg"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["opus", "audio/opus"],
  ["aiff", "audio/aiff"],
  ["aif", "audio/aiff"],
  ["wma", "audio/x-ms-wma"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["doc", "application/msword"],
  ["ppt", "application/vnd.ms-powerpoint"],
  ["xls", "application/vnd.ms-excel"],
  ["odt", "application/vnd.oasis.opendocument.text"],
  ["odp", "application/vnd.oasis.opendocument.presentation"],
  ["ods", "application/vnd.oasis.opendocument.spreadsheet"],
  ["rtf", "application/rtf"],
  ["epub", "application/epub+zip"],
])
const mediaMimes = new Set(mediaExtensions.values())

export const acceptedAttachments = [
  "video/*",
  "audio/*",
  ...[...mediaExtensions.keys()].map((extension) => `.${extension}`),
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/*",
  "application/json",
  "application/ld+json",
  "application/toml",
  "application/x-toml",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
  ".c",
  ".cc",
  ".cjs",
  ".conf",
  ".cpp",
  ".css",
  ".csv",
  ".cts",
  ".env",
  ".go",
  ".gql",
  ".graphql",
  ".h",
  ".hh",
  ".hpp",
  ".htm",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]

type PromptTarget = {
  current: () => PromptInputV2Prompt
  cursor: () => number | undefined
  set: (prompt: PromptInputV2Prompt, cursor?: number) => void
}

export type PromptInputV2AttachmentConfig = {
  picker?: (
    options: { defaultPath?: string; multiple?: boolean; accept?: string[] },
    onFile: (file: File) => Promise<unknown>,
    onReference?: (reference: AttachmentReference) => Promise<unknown>,
  ) => Promise<void>
  referenced?: (reference: AttachmentReference) => void
  tooLarge?: (name: string) => void
  directory: () => string
  isDialogActive: () => boolean
  warn: () => void
  duplicate: () => void
  onError: (error: unknown) => void
  readClipboardImage?: () => Promise<File | null>
  getPathForFile?: (file: File) => string
  store?: (file: File) => Promise<{ id: string; url: string }>
}

export function sortDrop(transfer: DataTransfer | null | undefined) {
  const items = Array.from(transfer?.items ?? []).flatMap((item) => {
    if (item.kind !== "file") return []
    const file = item.getAsFile()
    return file ? [{ file, folder: !!item.webkitGetAsEntry?.()?.isDirectory }] : []
  })
  if (items.length === 0) return { folders: [], files: Array.from(transfer?.files ?? []) }
  return {
    folders: items.filter((item) => item.folder).map((item) => item.file),
    files: items.filter((item) => !item.folder).map((item) => item.file),
  }
}

export function folderMention(file: File, path: string | undefined) {
  if (!path) return
  return {
    type: "file" as const,
    path,
    content: `@${file.name}`,
    start: 0,
    end: 0,
    mime: FOLDER_MIME,
    filename: file.name,
  }
}

export function createPromptInputV2Attachments(
  input: PromptInputV2AttachmentConfig & {
    capture: () => PromptTarget
    editor: () => HTMLElement | undefined
    focusEditor: () => void
    addPart: (part: PromptInputV2Prompt[number]) => boolean
    setDraggingType: (type: "image" | "@mention" | null) => void
  },
) {
  const capture = () => {
    const prompt = input.capture()
    const editor = input.editor()
    if (!editor) return
    return { prompt, cursor: prompt.cursor() ?? cursorPosition(editor) }
  }
  const addReference = async (reference: AttachmentReference, target = capture()) => {
    const added = await add(referenceFile(reference), false, target, false, reference.path)
    if (added) input.referenced?.(reference)
    return added
  }
  const add = async (
    file: File,
    toast = true,
    target = capture(),
    clipboard = false,
    source?: string,
  ): Promise<boolean> => {
    if (!target) return false
    if (file.size > MAX_INLINE_ATTACHMENT_BYTES) {
      const path = input.getPathForFile?.(file) || undefined
      if (path) return addReference({ name: file.name, path, size: file.size }, target)
      input.tooLarge?.(file.name)
      return true
    }
    const mime = await attachmentMime(file)
    if (!mime) {
      if (toast) input.warn()
      return false
    }
    const blob = input.store ? await input.store(file) : await blobReference(file)
    const sourcePath = source ?? (input.getPathForFile?.(file) || undefined)
    const duplicate = target.prompt
      .current()
      .some(
        (part) =>
          part.type === "image" &&
          part.blob.id === blob.id &&
          (sourcePath
            ? part.sourcePath === sourcePath
            : !part.sourcePath && (clipboard || part.filename === file.name)),
      )
    if (duplicate) {
      input.duplicate()
      return true
    }
    const attachment: PromptInputV2Attachment = {
      type: "image",
      id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2),
      filename: file.name,
      sourcePath,
      mime,
      blob,
    }
    target.prompt.set([...target.prompt.current(), attachment], target.cursor)
    return true
  }
  const addAttachments = async (files: File[], toast = true, target = capture()) => {
    const found = await files.reduce(async (result, file) => {
      const previous = await result
      return (await add(file, false, target)) || previous
    }, Promise.resolve(false))
    if (!found && files.length > 0 && toast) input.warn()
    return found
  }
  const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return
    const target = capture()
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    const files = Array.from(clipboardData.items).flatMap((item) => {
      if (item.kind !== "file") return []
      const file = item.getAsFile()
      return file ? [file] : []
    })
    if (files.length > 0) {
      await addAttachments(files, true, target)
      return
    }
    const plainText = clipboardData.getData("text/plain") ?? ""
    if (input.readClipboardImage && !plainText) {
      const file = await input.readClipboardImage()
      if (file && (await add(file, true, target, true))) return
    }
    if (!plainText) return
    const text = plainText.includes("\r") ? plainText.replace(/\r\n?/g, "\n") : plainText
    const put = () => {
      if (input.addPart({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor()
      return input.addPart({ type: "text", content: text, start: 0, end: 0 })
    }
    if (text.includes("\n") || largePaste(text)) {
      put()
      return
    }
    if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return
    put()
  }
  const handleDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return
    event.preventDefault()
    input.setDraggingType(null)
    const plainText = event.dataTransfer?.getData("text/plain")
    if (plainText?.startsWith("thread:")) {
      const [id = "", ...rest] = plainText.slice("thread:".length).split("\n")
      const title = rest.join(" ").trim() || id
      input.focusEditor()
      input.addPart({
        type: "file",
        path: title,
        content: `@${title}`,
        start: 0,
        end: 0,
        mime: "application/x-tenon-thread",
        filename: title,
        url: `tenon-thread://${encodeURIComponent(id)}`,
      })
      return
    }
    if (plainText?.startsWith("file:")) {
      const path = plainText.slice("file:".length)
      input.focusEditor()
      input.addPart({ type: "file", path, content: `@${path}`, start: 0, end: 0 })
      return
    }
    const drop = sortDrop(event.dataTransfer)
    drop.folders.forEach((file) => {
      const part = folderMention(file, input.getPathForFile?.(file))
      if (!part) return input.warn()
      input.focusEditor()
      input.addPart(part)
    })
    const files = drop.files
    if (files.length) await addAttachments(files)
  }

  onMount(() => {
    makeEventListener(document, "dragover", (event) => {
      if (input.isDialogActive()) return
      event.preventDefault()
      if (event.dataTransfer?.types.includes("Files")) input.setDraggingType("image")
      else if (event.dataTransfer?.types.includes("text/plain")) input.setDraggingType("@mention")
    })
    makeEventListener(document, "dragleave", (event) => {
      if (!input.isDialogActive() && !event.relatedTarget) input.setDraggingType(null)
    })
    makeEventListener(document, "drop", handleDrop)
  })

  return {
    addAttachments,
    handlePaste,
    handleDrop,
    pick(fallback: () => void) {
      if (!input.picker) {
        fallback()
        return
      }
      void input
        .picker(
          { defaultPath: input.directory(), multiple: true, accept: acceptedAttachments },
          (file) => add(file),
          (reference) => addReference(reference),
        )
        .catch(input.onError)
    },
  }
}

const imageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

async function blobReference(file: File) {
  const id = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return { id, url: URL.createObjectURL(file) }
}
const imageExtensions = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
])
const textMimes = new Set([
  "application/json",
  "application/ld+json",
  "application/toml",
  "application/x-toml",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
])

export async function attachmentMime(file: File) {
  const type = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  if (imageMimes.has(type) || type === "application/pdf") return type
  const index = file.name.lastIndexOf(".")
  const suffix = index === -1 ? "" : file.name.slice(index + 1).toLowerCase()
  const fallback = imageExtensions.get(suffix) ?? (suffix === "pdf" ? "application/pdf" : undefined)
  if ((!type || type === "application/octet-stream") && fallback) return fallback
  if (type.startsWith("video/") || type.startsWith("audio/") || mediaMimes.has(type)) return type
  const media = mediaExtensions.get(suffix)
  if ((!type || type === "application/octet-stream" || type === "application/zip") && media) return media
  if (type.startsWith("text/") || textMimes.has(type) || type.endsWith("+json") || type.endsWith("+xml")) {
    return "text/plain"
  }
  const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  if (bytes.some((byte) => byte === 0)) return
  const control = bytes.filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length
  if (bytes.length > 0 && control / bytes.length > 0.3) return
  return "text/plain"
}

function cursorPosition(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return 0
  const before = range.cloneRange()
  before.selectNodeContents(editor)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString().replace(/\u200B/g, "").length
}

function largePaste(text: string) {
  if (text.length >= 8000) return true
  return text.split("\n").length - 1 >= 120
}
