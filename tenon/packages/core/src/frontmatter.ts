export * as Frontmatter from "./frontmatter"

import matter from "gray-matter"

export const maxBytes = 64 * 1024

export const maxAliases = 25

export class RejectedError extends Error {
  constructor(readonly reason: "javascript_disabled" | "too_large" | "too_many_aliases") {
    super(`front matter rejected: ${reason}`)
  }
}

export function parse(source: string) {
  const normalized = source.startsWith("\uFEFF") ? source.slice(1) : source
  const len = frontmatterLength(normalized)
  if (len > maxBytes) throw new RejectedError("too_large")
  if (len > 0 && countYamlAliases(normalized.slice(0, len)) > maxAliases) {
    throw new RejectedError("too_many_aliases")
  }
  return matter(normalized, { engines: { javascript: disabledJavaScript } })
}

export function stringify(body: string, data: Record<string, unknown>) {
  return matter.stringify({ content: body }, data, { engines: { javascript: disabledJavaScript } })
}

function frontmatterLength(source: string) {
  if (!source.startsWith("---")) return 0
  const end = source.indexOf("\n---", 3)
  return end === -1 ? source.length : end
}

function countYamlAliases(block: string) {
  const matches = block.match(/(?:^|[\s,[\]{}:])\*[A-Za-z0-9_-]+/gm)
  return matches ? matches.length : 0
}

function disabledJavaScript(): never {
  throw new RejectedError("javascript_disabled")
}
