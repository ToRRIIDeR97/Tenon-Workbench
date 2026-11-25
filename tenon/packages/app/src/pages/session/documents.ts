import {
  localLinkTarget,
  outsideFileReferencePath,
  parseFileReference,
  resolveFileReferencePath,
} from "@tenon/session-ui/markdown-file-reference"
import { liveWrites } from "./live-document"
import { viewerKind } from "./viewer-kind"

export type ThreadDocument = {
  path: string
  outside?: boolean
  wrote: boolean
  writing: boolean
  at: number
}

type PartLike = { type: string; text?: string; tool?: string; callID?: string; state?: { status: string } }

const LIMIT = 200

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
    const key = outside ? `outside:${/^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path}` : path
    const last = found.get(key)
    found.set(key, {
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

function linkedPaths(text: string) {
  const links = [...text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].flatMap((match) => {
    const target = localLinkTarget(match[1])
    return target ? [target] : []
  })
  const cited = [...text.matchAll(/`([^`\n]+)`/g)].flatMap((match) => {
    const reference = parseFileReference(match[1])
    return reference && reference.kind !== "folder" ? [reference.path] : []
  })
  return [...links, ...cited]
}
