// Links typed or pasted into the composer are drawn blue and underlined, and open on Ctrl/⌘-click.
// They are styled with the CSS Custom Highlight API instead of <a> elements, so the editor's DOM
// (plain text nodes, pills and <br>s), its caret logic and the prompt text stay exactly as they are.

export type LinkMatch = { start: number; end: number; url: string }

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
const TRAILING = /[.,;:!?'"]+$/

/** The links in `text`: http(s) URLs and www. hosts, without trailing punctuation or an unmatched `)`/`]`. */
export function findLinks(text: string): LinkMatch[] {
  const links: LinkMatch[] = []
  for (const match of text.matchAll(LINK)) {
    let raw = match[0]
    for (;;) {
      const trimmed = raw.replace(TRAILING, "")
      const closer = trimmed.at(-1)
      const opener = closer === ")" ? "(" : closer === "]" ? "[" : undefined
      const unbalanced = opener && count(trimmed, closer!) > count(trimmed, opener)
      const next = unbalanced ? trimmed.slice(0, -1) : trimmed
      if (next === raw) break
      raw = next
    }
    if (raw.length <= (raw.startsWith("www.") ? 4 : raw.indexOf("//") + 2)) continue
    const start = match.index!
    links.push({ start, end: start + raw.length, url: raw.startsWith("www.") ? `https://${raw}` : raw })
  }
  return links
}

function count(text: string, char: string) {
  return text.split(char).length - 1
}

const HIGHLIGHT = "tenon-composer-link"
const editors = new Map<HTMLElement, { range: Range; url: string }[]>()

function supported() {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"
}

/** Runs of adjacent text nodes in `root`, skipping mention pills (they are not plain text). */
function textRuns(root: HTMLElement) {
  const runs: Text[][] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("[data-mention],[contenteditable=false]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  let previous: Text | undefined
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (previous && previous.nextSibling === node) runs.at(-1)!.push(node)
    else runs.push([node])
    previous = node
  }
  return runs
}

/** Where `offset` in a run's joined text falls: the node and the offset inside it. */
function locate(run: Text[], offset: number): [Text, number] {
  let remaining = offset
  for (const node of run) {
    if (remaining <= node.data.length) return [node, remaining]
    remaining -= node.data.length
  }
  const last = run.at(-1)!
  return [last, last.data.length]
}

function repaint() {
  if (!supported()) return
  const ranges = [...editors.values()].flat().map((link) => link.range)
  if (ranges.length === 0) return void CSS.highlights.delete(HIGHLIGHT)
  CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges))
}

function scan(editor: HTMLElement) {
  const links: { range: Range; url: string }[] = []
  for (const run of textRuns(editor)) {
    for (const match of findLinks(run.map((node) => node.data).join(""))) {
      const range = document.createRange()
      range.setStart(...locate(run, match.start))
      range.setEnd(...locate(run, match.end))
      links.push({ range, url: match.url })
    }
  }
  editors.set(editor, links)
  repaint()
}

/** The link under a pointer position in `editor`, if any. */
export function linkAt(editor: HTMLElement, x: number, y: number) {
  const links = editors.get(editor)
  if (!links?.length) return
  const caret = document.caretPositionFromPoint?.(x, y)
  const node = caret?.offsetNode
  if (!node || !editor.contains(node)) return
  const point = caret.offset
  return links.find((link) => {
    if (!link.range.isPointInRange(node, point)) return false
    // A caret at a link's edge can come from a click just past it; count only clicks on its text.
    return [...link.range.getClientRects()].some(
      (rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
    )
  })?.url
}

/**
 * Keeps `editor`'s links highlighted while it changes and opens one on Ctrl/⌘-click.
 * Returns a cleanup that stops watching and clears its highlights.
 */
export function watchComposerLinks(editor: HTMLElement) {
  let frame = 0
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => scan(editor))
  }
  const observer = new MutationObserver(schedule)
  observer.observe(editor, { characterData: true, childList: true, subtree: true })
  scan(editor)

  const modifier = (event: MouseEvent | KeyboardEvent) =>
    navigator.platform.startsWith("Mac") ? event.metaKey : event.ctrlKey
  const click = (event: MouseEvent) => {
    if (!modifier(event)) return
    const url = linkAt(editor, event.clientX, event.clientY)
    if (!url) return
    event.preventDefault()
    window.open(url, "_blank", "noopener,noreferrer")
  }
  // The pointer becomes a hand over a link while the modifier is held, as in code editors.
  let last: MouseEvent | undefined
  const hover = (event: MouseEvent) => {
    last = event
    editor.style.cursor = modifier(event) && linkAt(editor, event.clientX, event.clientY) ? "pointer" : ""
  }
  const key = (event: KeyboardEvent) => {
    if (!last) return
    editor.style.cursor = modifier(event) && linkAt(editor, last.clientX, last.clientY) ? "pointer" : ""
  }
  const leave = () => {
    last = undefined
    editor.style.cursor = ""
  }
  editor.addEventListener("click", click)
  editor.addEventListener("mousemove", hover)
  editor.addEventListener("mouseleave", leave)
  window.addEventListener("keydown", key)
  window.addEventListener("keyup", key)

  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    editor.removeEventListener("click", click)
    editor.removeEventListener("mousemove", hover)
    editor.removeEventListener("mouseleave", leave)
    window.removeEventListener("keydown", key)
    window.removeEventListener("keyup", key)
    editor.style.cursor = ""
    editors.delete(editor)
    repaint()
  }
}
