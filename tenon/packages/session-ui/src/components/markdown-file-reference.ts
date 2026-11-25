import { hasPathExtension, hasPathFileName, inlineCodeKind } from "./markdown-inline-code-kind"

export type FileReference = {
  path: string
  start?: number
  end?: number
  kind?: "folder" | "either"
  outside?: boolean
}

const referencePattern = /^(.+?)(?::(\d{1,7})(?:-(\d{1,7})|:\d{1,7})?|#L(\d{1,7})(?:-L?(\d{1,7}))?)?$/

export function parseFileReference(text: string): FileReference | undefined {
  const match = referencePattern.exec(localPath(text.trim()) ?? text.trim())
  if (!match) return
  const path = match[1]
  if (inlineCodeKind(path) !== "path") return
  const start = Number(match[2] ?? match[4] ?? 0)
  const end = Number(match[3] ?? match[5] ?? start)
  if (/[/\\]$/.test(path)) return start ? undefined : { path, kind: "folder" }
  const name = path.split(/[/\\]/).at(-1)!
  const file = hasPathExtension(name) || hasPathFileName(name)
  if (start < 1) return file ? { path } : { path, kind: "either" }
  return { path, start, end: end >= start ? end : start }
}

function localPath(text: string) {
  if (!/^file:\/\//i.test(text) || !URL.canParse(text)) return
  const url = new URL(text)
  if (url.hostname) return
  const path = decodeURIComponent(url.pathname)
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
}

export function localLinkTarget(href: string) {
  const value = href.trim()
  if (!value || value.startsWith("#") || value.startsWith("//")) return
  if (/^file:/i.test(value)) return localPath(value)
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)) return
  const path = value.replace(/[?#].*$/, "")
  if (!path) return
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

const citationPattern = /:{1,2}codex-file-citation\{([^}\n]*)\}/g

export function fileCitations(text: string) {
  if (!text.includes("codex-file-citation")) return text
  return text.replace(citationPattern, (whole, attributes: string) => {
    const read = (name: string) => new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s"']+))`).exec(attributes)
    const value = (name: string) => {
      const match = read(name)
      return match ? (match[1] ?? match[2] ?? match[3]) : undefined
    }
    const path = value("path")
    if (!path || path.includes("`")) return whole
    const start = Number(value("line_range_start") ?? 0)
    const end = Number(value("line_range_end") ?? start)
    const range = start > 0 ? (end > start ? `:${start}-${end}` : `:${start}`) : ""
    return `\`${path}${range}\``
  })
}

export function settleFileReference(
  reference: FileReference,
  type: "file" | "directory" | undefined,
): FileReference | undefined {
  if (reference.kind !== "either") return reference
  if (type === "directory") return { path: reference.path, kind: "folder" }
  if (type === "file") return { path: reference.path }
}

export function resolveFileReferencePath(input: string, directory: string) {
  if (!input || !directory || /[\u0000-\u001f]/.test(input)) return
  if (input.startsWith("~") || /^[A-Za-z]:(?![\\/])/.test(input)) return
  const windows = /^[A-Za-z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
  const value = windows ? input.replaceAll("\\", "/") : input
  const relative = absolute(value) ? inside(value, directory, windows) : value
  if (relative === undefined) return
  const segments = relative.split("/").filter((segment) => segment !== "" && segment !== ".")
  if (segments.length === 0 || segments.includes("..")) return
  return segments.join("/")
}

export function outsideFileReferencePath(input: string, directory: string) {
  if (!input || !directory || /[\u0000-\u001f]/.test(input)) return
  if (resolveFileReferencePath(input, directory) !== undefined) return
  const windows = /^[A-Za-z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
  const value = windows ? input.replaceAll("\\", "/") : input
  const drive = /^[A-Za-z]:\//.exec(value)?.[0]
  if (windows ? !drive : !value.startsWith("/")) return
  const segments = value
    .slice(drive ? 3 : 1)
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
  if (segments.length === 0 || segments.includes("..")) return
  return (drive ?? "/") + segments.join("/")
}

export function listedEntryPath(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "")
}

function absolute(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path)
}

function inside(path: string, directory: string, windows: boolean) {
  const root = (windows ? directory.replaceAll("\\", "/") : directory).replace(/\/+$/, "")
  const canon = (value: string) => (windows ? value.toLowerCase() : value)
  if (!root) return path.slice(1)
  if (!canon(path).startsWith(canon(root) + "/")) return
  return path.slice(root.length + 1)
}

export function fileReferenceRangeLabel(reference: Pick<FileReference, "start" | "end">) {
  if (!reference.start) return ""
  if (!reference.end || reference.end === reference.start) return `L${reference.start}`
  return `L${reference.start}–${reference.end}`
}
