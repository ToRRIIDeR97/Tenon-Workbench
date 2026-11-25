export type ViewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "model"
  | "markdown"
  | "csv"
  | "json"
  | "sheet"
  | "doc"
  | "file"

export type ViewItem = {
  src: string
  name: string
  kind: ViewKind
  remote: boolean
}

export type ViewWindowLabels = {
  open: string
  pin: string
  pinned: string
  unsupported: string
}

export type ViewSpace = {
  render: (host: HTMLElement, item: ViewItem) => void | (() => void)
  available?: (item: ViewItem) => boolean
  open?: (item: ViewItem) => void
  pin?: (item: ViewItem) => void
  pinned?: (item: ViewItem) => boolean
  watchPinned?: (item: ViewItem, change: (pinned: boolean) => void) => () => void
}

export const MAX_VIEW_ITEMS = 12

const kinds: Record<string, ViewKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
  svg: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  ogv: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  flac: "audio",
  m4a: "audio",
  aac: "audio",
  opus: "audio",
  pdf: "pdf",
  glb: "model",
  gltf: "model",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  csv: "csv",
  tsv: "csv",
  json: "json",
  xlsx: "sheet",
  xls: "sheet",
  ods: "sheet",
  docx: "doc",
}

export function viewKind(src: string): ViewKind {
  const path = src.split(/[?#]/)[0] ?? src
  const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase()
  return (ext && kinds[ext]) || "file"
}

export function viewItems(source: string): ViewItem[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^`(.*)`$/, "$1"))
    .filter((line) => line && !line.startsWith("#"))
    .flatMap((src) => {
      const scheme = src.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
      if (scheme && scheme.length > 1 && scheme !== "https") return []
      const remote = scheme === "https"
      const name = (src.split(/[?#]/)[0] ?? src).split(/[\\/]/).filter(Boolean).pop() ?? src
      return [{ src, name: decodeName(name), kind: viewKind(src), remote }]
    })
    .slice(0, MAX_VIEW_ITEMS)
}

function decodeName(name: string) {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

const mounted = new WeakMap<HTMLElement, { source: string; cleanups: Array<() => void> }>()

export function mountViewWindows(root: HTMLElement, labels: ViewWindowLabels, space: ViewSpace | undefined) {
  if (!space) return
  const codes = root.querySelectorAll<HTMLElement>("pre > code.language-view")
  for (const code of codes) {
    const pre = code.parentElement
    const wrapper = pre?.parentElement
    if (!pre || !wrapper || wrapper.dataset.component !== "markdown-code") continue
    if (wrapper.closest<HTMLElement>("[data-markdown-block]")?.dataset.markdownComplete === "false") continue
    const source = code.textContent ?? ""
    const previous = mounted.get(wrapper)
    if (previous?.source === source) continue
    previous?.cleanups.forEach((cleanup) => cleanup())
    wrapper.querySelector(':scope > [data-slot="view-windows"]')?.remove()
    const items = viewItems(source)
    if (items.length === 0) continue
    const list = document.createElement("div")
    list.dataset.slot = "view-windows"
    const cleanups = items.map((item) => {
      const view = frame(item, labels, space)
      list.appendChild(view.element)
      return view.cleanup
    })
    wrapper.dataset.viewWindow = ""
    wrapper.appendChild(list)
    mounted.set(wrapper, { source, cleanups })
  }
}

function frame(item: ViewItem, labels: ViewWindowLabels, space: ViewSpace) {
  const element = document.createElement("figure")
  element.dataset.slot = "view-window"
  element.dataset.kind = item.kind
  const bar = document.createElement("figcaption")
  bar.dataset.slot = "view-window-bar"
  const title = document.createElement("span")
  title.dataset.slot = "view-window-title"
  title.textContent = item.name
  title.title = item.src
  bar.appendChild(title)
  const usable = !item.remote && (space.available?.(item) ?? true)
  if (space.open && usable) bar.appendChild(button(labels.open, "open", () => space.open?.(item)))
  let unwatch = () => {}
  if (space.pin && usable) {
    const show = (pinned: boolean) => {
      pin.textContent = pinned ? labels.pinned : labels.pin
      pin.setAttribute("aria-pressed", String(pinned))
    }
    const pin = button(labels.pin, "pin", () => {
      space.pin?.(item)
      show(space.pinned?.(item) ?? false)
    })
    show(space.pinned?.(item) ?? false)
    unwatch = space.watchPinned?.(item, show) ?? unwatch
    bar.appendChild(pin)
  }
  element.appendChild(bar)
  const body = document.createElement("div")
  body.dataset.slot = "view-window-body"
  element.appendChild(body)
  const cleanup = space.render(body, item)
  return {
    element,
    cleanup: () => {
      unwatch()
      if (typeof cleanup === "function") cleanup()
    },
  }
}

function button(label: string, action: string, onClick: () => void) {
  const el = document.createElement("button")
  el.type = "button"
  el.textContent = label
  el.dataset.action = `view-${action}`
  el.addEventListener("click", onClick)
  return el
}
