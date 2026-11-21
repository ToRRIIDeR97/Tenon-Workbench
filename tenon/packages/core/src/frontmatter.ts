export * as Frontmatter from "./frontmatter"

import matter from "gray-matter"

/** Front matter larger than this is refused before YAML parsing, which blunts alias bombs. */
export const maxBytes = 64 * 1024

/** Maximum YAML alias tokens permitted in front matter to prevent billion-laughs expansion. */
export const maxAliases = 25

export class RejectedError extends Error {
  constructor(readonly reason: "javascript_disabled" | "too_large" | "too_many_aliases") {
    super(`front matter rejected: ${reason}`)
  }
}

/**
 * Parse Markdown front matter from untrusted files. gray-matter evaluates a
 * `---js` (or `---javascript`) block with `eval`, so that engine always throws.
 * Passing options also disables gray-matter's unbounded module-level parse cache.
 */
export function parse(source: string) {
  const normalized = source.startsWith("\uFEFF") ? source.slice(1) : source
  const len = frontmatterLength(normalized)
  if (len > maxBytes) throw new RejectedError("too_large")
  if (len > 0 && countYamlAliases(normalized.slice(0, len)) > maxAliases) {
    throw new RejectedError("too_many_aliases")
  }
  return matter(normalized, { engines: { javascript: disabledJavaScript } })
}

/** Serialize Markdown front matter without re-parsing `body` through gray-matter engines. */
export function stringify(body: string, data: Record<string, unknown>) {
  return matter.stringify({ content: body }, data, { engines: { javascript: disabledJavaScript } })
}

/** Characters between the opening `---` and the closing delimiter (or the end of the file). */
function frontmatterLength(source: string) {
  if (!source.startsWith("---")) return 0
  const end = source.indexOf("\n---", 3)
  return end === -1 ? source.length : end
}

/** Counts YAML alias references (`*alias`) inside front matter lines. */
function countYamlAliases(block: string) {
  const matches = block.match(/(?:^|[\s,[\]{}:])\*[A-Za-z0-9_-]+/gm)
  return matches ? matches.length : 0
}

function disabledJavaScript(): never {
  throw new RejectedError("javascript_disabled")
}
