import { findRanges } from "./find-text"

const ALL = "tenon-page-find"
const CURRENT = "tenon-page-find-current"
const SKIPPED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "TEMPLATE", "SVG"])

function readable(node: Text, root: HTMLElement) {
  for (let element = node.parentElement; element; element = element.parentElement) {
    if (SKIPPED.has(element.tagName.toUpperCase())) return false
    if (element.hidden || element.getAttribute("aria-hidden") === "true" || element.hasAttribute("data-find-skip"))
      return false
    if (element === root) break
  }
  const parent = node.parentElement
  if (!parent) return false
  if (typeof parent.checkVisibility === "function") return parent.checkVisibility()
  return true
}

export function domRanges(root: HTMLElement, query: string): Range[] {
  if (!query.trim()) return []
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const ranges: Range[] = []
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.data.trim() || !readable(node, root)) continue
    for (const match of findRanges(node.data, query)) {
      const range = root.ownerDocument.createRange()
      range.setStart(node, match.start)
      range.setEnd(node, match.end)
      ranges.push(range)
    }
  }
  return ranges
}

const highlights = () => (typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : undefined)

export function paintRanges(ranges: ReadonlyArray<Range>, current: number) {
  const registry = highlights()
  if (!registry || typeof Highlight === "undefined") return
  if (ranges.length === 0) {
    clearPaint()
    return
  }
  registry.set(ALL, new Highlight(...ranges))
  const active = ranges[current]
  if (active) registry.set(CURRENT, new Highlight(active))
  else registry.delete(CURRENT)
}

export function clearPaint() {
  const registry = highlights()
  registry?.delete(ALL)
  registry?.delete(CURRENT)
}

export function revealRange(range: Range | undefined) {
  const element = range?.startContainer.parentElement
  element?.scrollIntoView({ block: "center", inline: "nearest" })
}

export function textareaRanges(textarea: HTMLTextAreaElement, query: string) {
  return findRanges(textarea.value, query)
}

export function revealInTextarea(textarea: HTMLTextAreaElement, range: { start: number; end: number } | undefined) {
  if (!range) return
  textarea.setSelectionRange(range.start, range.end)
  const line = textarea.value.slice(0, range.start).split("\n").length - 1
  const height = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20
  textarea.scrollTop = Math.max(0, line * height - textarea.clientHeight / 2)
}
