import { randomUUID } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, posix, resolve, win32 } from "node:path"
import { pathToFileURL } from "node:url"
import { net, protocol } from "electron"
import { isUncPath } from "./local-file-policy"

export const fileViewerProtocol = "tenon-file"
const host = "local"
const issued = new Map<string, string>()
const MAX_ISSUED = 500

export const fileViewerScheme = {
  scheme: fileViewerProtocol,
  privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, corsEnabled: true },
} as const

export function resolveInside(directory: string, path: string) {
  if (!isAbsolute(directory) || isUncPath(directory)) return
  const file = resolve(directory, path)
  return isInside(resolve(directory), file) ? file : undefined
}

export function isInside(root: string, file: string, platform: NodeJS.Platform = process.platform) {
  const paths = platform === "win32" ? win32 : posix
  const fold = platform === "win32" || platform === "darwin"
  const rel = paths.relative(fold ? root.toLowerCase() : root, fold ? file.toLowerCase() : file)
  return Boolean(rel) && !rel.startsWith("..") && !paths.isAbsolute(rel)
}

const ALLOWED_VIEWER_EXTENSIONS = new Set([
  ".pdf",
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".ogv",
  ".xlsx",
  ".xls",
  ".ods",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".flac",
  ".m4a",
  ".aac",
  ".opus",
  ".glb",
  ".gltf",
])

export async function fileViewerURL(directory: string, path: string) {
  const lexical = resolveInside(directory, path)
  if (!lexical) return
  const requestedExt = extname(lexical).toLowerCase()
  if (!ALLOWED_VIEWER_EXTENSIONS.has(requestedExt)) return
  const [root, file] = await Promise.all([realpath(directory), realpath(lexical)]).catch(() => [])
  if (!root || !file || !isInside(root, file)) return
  if (extname(file).toLowerCase() !== requestedExt) return
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) return
  const token = randomUUID()
  issued.set(token, file)
  if (issued.size > MAX_ISSUED) issued.delete(issued.keys().next().value!)
  return `${fileViewerProtocol}://${host}/${token}/${encodeURIComponent(basename(file))}`
}

const pdfViewerOrigin = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/"

export function isFileViewerFrameURL(value: string) {
  if (value.startsWith(pdfViewerOrigin)) return true
  if (!value.startsWith(`${fileViewerProtocol}://${host}/`)) return false
  return issued.has(new URL(value).pathname.split("/")[1] ?? "")
}

export function registerFileViewerProtocol() {
  if (protocol.isProtocolHandled(fileViewerProtocol)) return
  protocol.handle(fileViewerProtocol, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response("Bad request", { status: 400 })
    }
    const file = url.host === host ? issued.get(url.pathname.split("/")[1] ?? "") : undefined
    if (!file || request.method !== "GET") return new Response("Not found", { status: 404 })
    const range = request.headers.get("range")
    const response = await net
      .fetch(pathToFileURL(file).toString(), { headers: range ? { range } : undefined })
      .catch(() => undefined)
    if (!response) return new Response("Not found", { status: 404 })
    const headers = new Headers(response.headers)
    const origin = request.headers.get("origin")
    if (origin && (origin === "oc://renderer" || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) {
      headers.set("Access-Control-Allow-Origin", origin)
      headers.set("Vary", "Origin")
    }
    headers.set("X-Content-Type-Options", "nosniff")
    if (extname(file).toLowerCase() !== ".pdf") {
      headers.set("Content-Security-Policy", "default-src 'none'; script-src 'none'; object-src 'none'")
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })
}
