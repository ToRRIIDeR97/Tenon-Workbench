import { checksum } from "@tenon/core/util/encode"
import { designInspectScript } from "./design-inspect"

export type DesignInfo = { title?: string; canvas: boolean }

export type DesignFence = DesignInfo & { source: string; closed: boolean }

export type Design = { id: string; title?: string; source: string; canvas: boolean }

export type CanvasDesign = Design & { key: string; streaming?: boolean }

export const MAX_DESIGN_BYTES = 512 * 1024

export const DESIGN_SANDBOX = "allow-scripts"

export const DESIGN_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:"

const MAX_TITLE = 120
const fence = /^([ \t]*)(`{3,}|~{3,})(.*)$/
const attribute = /([A-Za-z][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))|(\S+)/g

export function designInfo(info: string): DesignInfo {
  const rest = info.trim().replace(/^\S+/, "")
  const words = [...rest.matchAll(attribute)]
  const title = words.find((match) => match[1]?.toLowerCase() === "title")
  const text = title ? (title[2]?.replace(/\\(.)/g, "$1") ?? title[3] ?? title[4] ?? "") : ""
  return {
    title: cleanTitle(text),
    canvas: words.some((match) => match[5]?.toLowerCase() === "canvas"),
  }
}

export function isDesignInfo(info: string) {
  return info.trim().split(/\s+/, 1)[0] === "html"
}

export function designFences(text: string): DesignFence[] {
  const lines = text.split(/\r?\n/)
  const result: DesignFence[] = []
  let open: { mark: string; indent: number; info: string; body: string[] } | undefined
  for (const line of lines) {
    if (open) {
      if (closes(line, open.mark)) {
        if (isDesignInfo(open.info))
          result.push({ ...designInfo(open.info), source: open.body.join("\n"), closed: true })
        open = undefined
        continue
      }
      open.body.push(dedent(line, open.indent))
      continue
    }
    const match = line.match(fence)
    if (!match) continue
    if (match[2].startsWith("`") && match[3].includes("`")) continue
    open = { mark: match[2], indent: match[1].length, info: match[3], body: [] }
  }
  if (open && isDesignInfo(open.info))
    result.push({ ...designInfo(open.info), source: open.body.join("\n"), closed: false })
  return result
}

export function designID(source: string) {
  return checksum(source.trimEnd()) ?? "empty"
}

export function designTooLarge(source: string) {
  if (source.length > MAX_DESIGN_BYTES) return true
  return new TextEncoder().encode(source).length > MAX_DESIGN_BYTES
}

export function designDocument(
  source: string,
  options: { autosize?: boolean; nonce?: string; inspect?: boolean } = {},
) {
  const csp = options.nonce
    ? DESIGN_CSP.replace("script-src 'unsafe-inline'", `script-src 'nonce-${options.nonce}'`)
    : DESIGN_CSP
  const script = options.nonce ? `<script nonce="${options.nonce}">` : "<script>"
  return [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    webrtcGuardScript.replace("<script>", script),
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    frameScrollbar,
    options.autosize ? autosizeScript.replace("<script>", script) : "",
    options.inspect ? designInspectScript.replace("<script>", script) : "",
    source,
  ].join("")
}

const frameScrollbar =
  "<style>::-webkit-scrollbar{width:12px;height:12px;background:transparent}" +
  "::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}" +
  "::-webkit-scrollbar-button{display:none;width:0;height:0}" +
  "::-webkit-scrollbar-thumb{min-height:32px;min-width:32px;border:4px solid transparent;border-radius:9999px;" +
  "background-color:rgb(128 128 128/.35);background-clip:padding-box}" +
  ":hover::-webkit-scrollbar-thumb,::-webkit-scrollbar-thumb:hover,::-webkit-scrollbar-thumb:active{" +
  "background-color:rgb(128 128 128/.6)}</style>"

const webrtcGuardScript =
  '<script>["RTCPeerConnection","webkitRTCPeerConnection","RTCDataChannel"].forEach((name)=>' +
  "Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false}))</script>"

const autosizeScript =
  "<script>(()=>{let last=0;const send=()=>{const h=Math.ceil(document.documentElement.scrollHeight);" +
  "if(h!==last){last=h;parent.postMessage(h,'*')}};addEventListener('load',send);" +
  "new ResizeObserver(send).observe(document.documentElement)})()</script>"

export function collectDesigns(
  messages: readonly { id: string; role: string }[],
  parts: Readonly<Record<string, readonly { id: string; type: string; text?: string }[] | undefined>>,
  pinned: readonly string[] = [],
  scan: (part: { id: string; text: string }) => DesignFence[] = (part) => designFences(part.text),
  options: { streaming?: boolean } = {},
) {
  const keep = new Set(pinned)
  const seen = new Set<string>()
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => parts[message.id] ?? [])
    .flatMap((part) =>
      part.type === "text" && part.text
        ? scan({ id: part.id, text: part.text }).map((fence, index) => ({ fence, key: `${part.id}:${index}` }))
        : [],
    )
    .flatMap((item): CanvasDesign[] => {
      const fence = item.fence
      if (!fence.closed)
        return options.streaming && fence.canvas
          ? [{ id: item.key, key: item.key, title: fence.title, source: fence.source, canvas: true, streaming: true }]
          : []
      const id = designID(fence.source)
      if (seen.has(id) || !(fence.canvas || keep.has(id))) return []
      seen.add(id)
      return [{ id, key: item.key, title: fence.title, source: fence.source, canvas: fence.canvas }]
    })
}

export function collectToolDesigns(
  messages: readonly { id: string; role: string }[],
  parts: Readonly<Record<string, readonly ToolPartLike[] | undefined>>,
) {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => parts[message.id] ?? [])
    .flatMap((part): CanvasDesign[] => {
      const path = part.state?.input?.filePath
      if (part.type !== "tool" || part.tool !== "write" || !part.callID || !part.state) return []
      if (typeof path !== "string" || !/\.html?$/i.test(path)) return []
      const content = part.state.input?.content
      const source = typeof content === "string" ? content : ""
      const streaming = part.state.status === "pending" || part.state.status === "running"
      return [
        {
          id: streaming ? part.callID : designID(source),
          key: part.callID,
          title: path.split(/[\\/]/).pop(),
          source,
          canvas: true,
          streaming,
        },
      ]
    })
}

type ToolPartLike = {
  type: string
  tool?: string
  callID?: string
  state?: { status: string; input?: Readonly<Record<string, unknown>> }
}

function cleanTitle(value: string) {
  const title = Array.from(value)
    .filter((char) => char >= " " && char !== "\u007f")
    .join("")
    .trim()
  return title ? title.slice(0, MAX_TITLE) : undefined
}

function closes(line: string, mark: string) {
  const match = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)
  return !!match && match[1][0] === mark[0] && match[1].length >= mark.length
}

function dedent(line: string, indent: number) {
  if (!indent) return line
  const strip = line.match(/^[ \t]*/)![0].length
  return line.slice(Math.min(strip, indent))
}
