export * as WikiLinks from "./wiki-links"

const LINK = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+)|(\\?)\[\[([^[\]\n]+)\]\]/g

export function normalize(value: string) {
  return value.trim().replaceAll("\\", "/").replace(/\.md$/i, "").replace(/\s+/g, "-").toLowerCase()
}

function splitReference(reference: string) {
  const [target = "", alias] = reference.split("|", 2)
  const anchor = /[#^]/.exec(target)
  return {
    target: anchor ? target.slice(0, anchor.index) : target,
    suffix: anchor ? target.slice(anchor.index) : "",
    alias,
  }
}

export function targetKey(reference: string) {
  return normalize(splitReference(reference).target)
}

export function pageKeys(page: { path: string; title: string }) {
  const path = normalize(page.path)
  return new Set([normalize(page.title), path, path.split("/").pop() ?? path].filter(Boolean))
}

export type Link = { index: number; length: number; reference: string; key: string }

export function links(body: string): Link[] {
  const found: Link[] = []
  for (const match of body.matchAll(LINK)) {
    if (match[1] || match[2]) continue
    const reference = match[3] ?? ""
    found.push({ index: match.index ?? 0, length: match[0].length, reference, key: targetKey(reference) })
  }
  return found
}

export function linksTo(body: string, keys: ReadonlySet<string>) {
  return links(body).find((link) => keys.has(link.key))?.index ?? -1
}

export function rewriteLinks(body: string, keys: ReadonlySet<string> | ((key: string) => boolean), target: string) {
  const matches = typeof keys === "function" ? keys : (key: string) => keys.has(key)
  let count = 0
  const next = body.replace(LINK, (source, code: string | undefined, escaped: string, reference: string) => {
    if (code || escaped || !matches(targetKey(reference))) return source
    count += 1
    const parts = splitReference(reference)
    return `[[${target}${parts.suffix}${parts.alias === undefined ? "" : `|${parts.alias}`}]]`
  })
  return { body: count === 0 ? body : next, count }
}

export function snippet(text: string, index: number, length: number, radius = 60) {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + length + radius)
  const middle = text.slice(start, end).replace(/\s+/g, " ").trim()
  return `${start > 0 ? "…" : ""}${middle}${end < text.length ? "…" : ""}`
}
