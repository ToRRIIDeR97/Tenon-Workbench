import { bundledLanguagesInfo } from "shiki/langs"
import { getFilename } from "@tenon/core/util/path"
import type { FilePart } from "@opencode-ai/sdk/v2"

export function attached(part: FilePart) {
  return part.url.startsWith("data:") && !inline(part)
}

export function inline(part: FilePart) {
  return part.source?.text?.start !== undefined && part.source?.text?.end !== undefined
}

export function kind(part: FilePart) {
  return part.mime.startsWith("image/") ? "image" : "file"
}

const LANGUAGE_NAMES = new Map<string, string>(
  bundledLanguagesInfo.flatMap((info) =>
    [info.id, ...(info.aliases ?? [])].map((alias) => [alias, info.name] as [string, string]),
  ),
)

export function typeLabel(filename: string, mime: string, fallback: string, threadLabel?: string) {
  if (mime === "application/pdf") return "PDF"
  if (mime === "application/x-tenon-thread" && threadLabel) return threadLabel
  const base = getFilename(filename)
  const idx = base.lastIndexOf(".")
  const suffix = idx <= 0 ? "" : base.slice(idx + 1).toLowerCase()
  if (!suffix) return fallback
  return LANGUAGE_NAMES.get(suffix) ?? suffix.toUpperCase()
}
