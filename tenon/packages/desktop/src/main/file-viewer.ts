import { randomUUID } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, posix, resolve, win32 } from "node:path"
import { pathToFileURL } from "node:url"
import { net, protocol } from "electron"
import { isUncPath } from "./local-file-policy"

// The Workbench panel shows PDFs, videos and Office files that are too large to pass around as data
// URLs. The renderer asks for a file by folder and relative path; main checks the path stays inside
// that folder and hands back an opaque tenon-file:// URL. The protocol serves only URLs it issued,
// read-only, with range requests so video can seek.
export const fileViewerProtocol = "tenon-file"
const host = "local"
// Issued URLs, oldest first. A long session keeps only the most recent ones.
const issued = new Map<string, string>()
const MAX_ISSUED = 500

export const fileViewerScheme = {
  scheme: fileViewerProtocol,
  privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, corsEnabled: true },
} as const

/** The file `path` inside `directory`, or undefined when it escapes the folder, is relative or is a UNC path. */
export function resolveInside(directory: string, path: string) {
  if (!isAbsolute(directory) || isUncPath(directory)) return
  const file = resolve(directory, path)
  return isInside(resolve(directory), file) ? file : undefined
}

/**
 * Whether `file` lies strictly inside `root`, both absolute. Windows and macOS (APFS by default)
 * compare names case-insensitively, so `C:\Work` contains `c:\work\a.pdf`.
 */
export function isInside(root: string, file: string, platform: NodeJS.Platform = process.platform) {
  const paths = platform === "win32" ? win32 : posix
  const fold = platform === "win32" || platform === "darwin"
  const rel = paths.relative(fold ? root.toLowerCase() : root, fold ? file.toLowerCase() : file)
  return Boolean(rel) && !rel.startsWith("..") && !paths.isAbsolute(rel)
}

export async function fileViewerURL(directory: string, path: string) {
  const lexical = resolveInside(directory, path)
  if (!lexical) return
  // The lexical check alone would follow a symlink in the folder out to ~/.ssh/id_rsa: resolve
  // links on both sides and check again. The issued URL serves the resolved file.
  const [root, file] = await Promise.all([realpath(directory), realpath(lexical)]).catch(() => [])
  if (!root || !file || !isInside(root, file)) return
  // The renderer picks the viewer from the requested name, but the served type follows the resolved file, so
  // `report.pdf -> page.html` would run HTML in the frame. A link must keep its target's extension.
  if (extname(file).toLowerCase() !== extname(lexical).toLowerCase()) return
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) return
  const token = randomUUID()
  issued.set(token, file)
  if (issued.size > MAX_ISSUED) issued.delete(issued.keys().next().value!)
  return `${fileViewerProtocol}://${host}/${token}/${encodeURIComponent(basename(file))}`
}

// Chromium's built-in PDF viewer, which a PDF in a tenon-file:// frame hands off to.
const pdfViewerOrigin = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/"

/** A frame may load a file this module issued, and the PDF viewer that shows it. */
export function isFileViewerFrameURL(value: string) {
  if (value.startsWith(pdfViewerOrigin)) return true
  if (!value.startsWith(`${fileViewerProtocol}://${host}/`)) return false
  return issued.has(new URL(value).pathname.split("/")[1] ?? "")
}

export function registerFileViewerProtocol() {
  if (protocol.isProtocolHandled(fileViewerProtocol)) return
  protocol.handle(fileViewerProtocol, async (request) => {
    const url = new URL(request.url)
    const file = url.host === host ? issued.get(url.pathname.split("/")[1] ?? "") : undefined
    if (!file || request.method !== "GET") return new Response("Not found", { status: 404 })
    const range = request.headers.get("range")
    const response = await net.fetch(pathToFileURL(file).toString(), { headers: range ? { range } : undefined })
    // The renderer (oc://renderer, or the dev server) reads spreadsheets and documents with fetch().
    const headers = new Headers(response.headers)
    headers.set("Access-Control-Allow-Origin", "*")
    headers.set("X-Content-Type-Options", "nosniff")
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })
}
