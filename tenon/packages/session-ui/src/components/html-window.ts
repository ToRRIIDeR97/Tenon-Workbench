import type { DesignSpace } from "../context/design"
import {
  DESIGN_SANDBOX,
  designDocument,
  designFences,
  designID,
  designInfo,
  designTooLarge,
  type Design,
  type DesignInfo,
} from "./design-fence"

export type HtmlWindowLabels = {
  title: string
  badge: string
  use: string
  open: string
  source: string
  preview: string
  streaming: string
  tooLarge: string
  card: (title: string) => string
}

type Options = {
  space?: DesignSpace
  live: boolean
}

const MIN_HEIGHT = 48
const MAX_HEIGHT = 720
const INITIAL_HEIGHT = 160
const mounted = new WeakMap<HTMLElement, string>()

export function mountHtmlWindows(root: HTMLElement, raw: string, labels: HtmlWindowLabels, options: Options) {
  const codes = root.querySelectorAll<HTMLElement>("pre > code.language-html")
  if (codes.length === 0) return
  let fences: ReturnType<typeof designFences> | undefined
  for (const code of codes) {
    const pre = code.parentElement
    const wrapper = pre?.parentElement
    if (!pre || !wrapper || wrapper.dataset.component !== "markdown-code") continue
    const complete = wrapper.closest<HTMLElement>("[data-markdown-block]")?.dataset.markdownComplete !== "false"
    if (!complete) {
      const info = streamingInfo(raw)
      const key = `streaming:${info.canvas}:${info.title ?? ""}`
      if (mounted.get(wrapper) === key) continue
      mount(wrapper, pre, { ...info, id: "", source: "" }, labels, options, true)
      mounted.set(wrapper, key)
      continue
    }
    const source = code.textContent ?? ""
    const id = designID(source)
    fences ??= designFences(raw)
    const info: DesignInfo = fences.find((fence) => fence.closed && designID(fence.source) === id) ?? { canvas: false }
    const key = `done:${id}:${info.canvas}:${info.title ?? ""}`
    const previous = mounted.get(wrapper)
    if (
      previous === key &&
      wrapper.querySelector(':scope > [data-slot="html-window-bar"], :scope > [data-slot="html-window-card"]')
    )
      continue
    const design = { id, title: info.title, source, canvas: info.canvas }
    mount(wrapper, pre, design, labels, options, false)
    mounted.set(wrapper, key)
    if (options.live && design.canvas && previous !== key) options.space?.reveal?.(design)
  }
}

function streamingInfo(raw: string): DesignInfo {
  const head = raw
    .trimStart()
    .split("\n", 1)[0]
    .match(/^(`{3,}|~{3,})(.*)$/)
  if (head) return designInfo(head[2])
  return designFences(raw).findLast((fence) => !fence.closed) ?? { canvas: false }
}

function mount(
  wrapper: HTMLElement,
  pre: HTMLElement,
  design: Design,
  labels: HtmlWindowLabels,
  options: Options,
  streaming: boolean,
) {
  const finished = !streaming && !!wrapper.querySelector(':scope > [data-slot="html-window-notice"][data-streaming]')
  unmount(wrapper)
  listen()
  const title = design.title ?? labels.title
  const large = !streaming && designTooLarge(design.source)
  wrapper.dataset.htmlWindow = design.canvas ? "card" : "window"
  const sourceToggle = (hidden: string, shown: string, back = labels.source) => {
    const pressable = back === labels.source
    const el = button(labels.source, () => {
      const showing = wrapper.dataset.htmlWindow === shown
      wrapper.dataset.htmlWindow = showing ? hidden : shown
      wrapper.dataset.htmlWindowToggled = ""
      el.textContent = showing ? labels.source : back
      if (pressable) el.setAttribute("aria-pressed", String(!showing))
    })
    if (pressable) el.setAttribute("aria-pressed", "false")
    return el
  }

  if (design.canvas) {
    const card = element("div", "html-window-card")
    const name = element("span", "html-window-title")
    name.textContent = labels.card(title)
    card.append(name)
    if (streaming || large) {
      const status = element("span", "html-window-status")
      status.textContent = streaming ? labels.streaming : labels.tooLarge
      card.append(status)
    }
    if (!streaming) card.append(sourceToggle("card", "card-source"))
    if (!streaming && !large && options.space?.open) {
      const open = button(labels.open, () => options.space?.open?.(design))
      open.dataset.action = "open"
      card.append(open)
    }
    wrapper.insertBefore(card, pre)
    return
  }

  const bar = element("div", "html-window-bar")
  const name = element("span", "html-window-title")
  name.textContent = title
  const badge = element("span", "html-window-badge")
  badge.textContent = labels.badge
  bar.append(name, badge)
  wrapper.insertBefore(bar, pre)

  if (streaming || large) {
    const notice = element("div", "html-window-notice")
    notice.textContent = streaming ? labels.streaming : labels.tooLarge
    if (streaming) notice.dataset.streaming = ""
    else bar.append(sourceToggle("window", "source"))
    wrapper.insertBefore(notice, pre)
    return
  }

  bar.append(sourceToggle("window", "source", labels.preview))
  const view = frame(design.source, title)
  if (finished) view.dataset.enter = ""
  wrapper.insertBefore(view, pre)
  const footer = element("div", "html-window-footer")
  if (options.space?.use) footer.append(button(labels.use, () => options.space?.use?.(design)))
  if (options.space?.open) footer.append(button(labels.open, () => options.space?.open?.(design)))
  if (footer.childElementCount > 0) wrapper.insertBefore(footer, pre)
}

function frame(source: string, title: string) {
  const el = document.createElement("iframe")
  el.dataset.slot = "html-window-frame"
  el.setAttribute("sandbox", DESIGN_SANDBOX)
  el.setAttribute("referrerpolicy", "no-referrer")
  el.setAttribute("loading", "lazy")
  el.title = title
  el.style.height = `${INITIAL_HEIGHT}px`
  el.srcdoc = designDocument(source, { autosize: true })
  return el
}

function unmount(wrapper: HTMLElement) {
  wrapper
    .querySelectorAll(
      ':scope > [data-slot="html-window-bar"], :scope > [data-slot="html-window-frame"], :scope > [data-slot="html-window-notice"], :scope > [data-slot="html-window-footer"], :scope > [data-slot="html-window-card"]',
    )
    .forEach((el) => el.remove())
  delete wrapper.dataset.htmlWindow
  delete wrapper.dataset.htmlWindowToggled
  mounted.delete(wrapper)
}

function element(tag: "div" | "span", slot: string) {
  const el = document.createElement(tag)
  el.dataset.slot = slot
  return el
}

function button(label: string, onClick: () => void) {
  const el = document.createElement("button")
  el.type = "button"
  el.textContent = label
  el.addEventListener("click", onClick)
  return el
}

let listening = false

function listen() {
  if (listening) return
  listening = true
  window.addEventListener("message", (event) => {
    if (event.origin !== "null" || typeof event.data !== "number" || !Number.isFinite(event.data)) return
    const target = Array.from(
      document.querySelectorAll<HTMLIFrameElement>('iframe[data-slot="html-window-frame"]'),
    ).find((el) => el.contentWindow === event.source)
    if (!target) return
    target.style.height = `${Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(event.data)))}px`
  })
}
