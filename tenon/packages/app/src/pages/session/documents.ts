import {
  localLinkTarget,
  outsideFileReferencePath,
  parseFileReference,
  resolveFileReferencePath,
} from "@tenon/session-ui/markdown-file-reference"
import { liveWrites } from "./live-document"
import { viewerKind } from "./viewer-kind"

/** A document the thread's agent wrote or linked. `path` is relative to the thread's folder unless `outside`. */
export type ThreadDocument = {
  path: string
  outside?: boolean
  wrote: boolean
  writing: boolean
  /** When the agent last wrote or linked it (the reply's creation time). */
  at: number
}

type PartLike = { type: string; text?: string; tool?: string; callID?: string; state?: { status: string } }

/** At most this many documents are listed; a long thread keeps its newest. */
const LIMIT = 200

/**
 * The documents a thread's agent wrote, edited or linked (a Markdown link or a cited path), newest first with the
 * ones being written on top. Only files the panel's viewer renders count (Markdown, CSV, JSON, PDF, video,
 * spreadsheets, Word); `.html` designs belong to Canvas. Paths come from agent output, so each must stay inside the
 * thread's folder or be a plain absolute path outside it (`resolveFileReferencePath`, `outsideFileReferencePath`).
 */
export function threadDocuments(
  replies: ReadonlyArray<{ created: number; parts: ReadonlyArray<PartLike> }>,
  directory: string,
): ThreadDocument[] {
  const found = new Map<string, ThreadDocument>()
  const add = (raw: string, at: number, write?: { writing: boolean }) => {
    const inside = resolveFileReferencePath(raw, directory)
    const outside = inside === undefined ? outsideFileReferencePath(raw, directory) : undefined
    const path = inside ?? outside
    if (!path || !viewerKind(path)) return
    // Windows drive paths name one file whatever their letter case.
    const key = outside ? `outside:${/^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path}` : path
    const last = found.get(key)
    found.set(key, {
      // The first spelling stays, as for folders elsewhere.
      path: last?.path ?? path,
      ...(outside ? { outside: true } : {}),
      wrote: !!write || !!last?.wrote,
      writing: !!write?.writing || !!last?.writing,
      at: Math.max(at, last?.at ?? 0),
    })
  }
  replies.forEach((reply) => {
    liveWrites(reply.parts).forEach((write) =>
      add(write.path, reply.created, { writing: write.status === "streaming" || write.status === "running" }),
    )
    reply.parts.forEach((part) => {
      if (part.type !== "text" || !part.text) return
      linkedPaths(part.text).forEach((raw) => add(raw, reply.created))
    })
  })
  return [...found.values()].sort((a, b) => Number(b.writing) - Number(a.writing) || b.at - a.at).slice(0, LIMIT)
}

/** Local file targets of Markdown links and file paths cited in inline code. */
function linkedPaths(text: string) {
  const links = [...text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].flatMap((match) => {
    const target = localLinkTarget(match[1])
    return target ? [target] : []
  })
  const cited = [...text.matchAll(/`([^`\n]+)`/g)].flatMap((match) => {
    const reference = parseFileReference(match[1])
    // An extensionless-looking `either` path still counts here: only document extensions pass `viewerKind`.
    return reference && reference.kind !== "folder" ? [reference.path] : []
  })
  return [...links, ...cited]
}
