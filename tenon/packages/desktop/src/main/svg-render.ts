import { BrowserWindow } from "electron"
import { report, type Inspection } from "./svg-report"

// The chat shows a diagram across the timeline column (about 760px) and caps its height (session-ui svg-window.ts).
const CHAT_WIDTH = 760
const CHAT_MAX_HEIGHT = 640
const PADDING = 16
// The chat's dark theme tokens, so the picture matches what the user sees.
const THEME =
  "--tenon-fg:#f2f2f2;--tenon-muted:#aeaeae;--tenon-accent:#7698fd;--tenon-surface:#2e2e2e;--tenon-border:#ffffff1a"

let window: BrowserWindow | undefined
let queue: Promise<unknown> = Promise.resolve()

/**
 * Renders an agent's SVG the way the chat shows it, in a hidden offscreen window whose page has the chat's strict
 * CSP (no scripts, no network), measures every label, and returns a PNG with the problems it found. Renders run
 * one at a time on the same window.
 */
export function renderSvg(svg: string): Promise<{ text: string; image: string }> {
  const run = queue.then(() => render(svg))
  queue = run.catch(() => undefined)
  return run
}

async function render(svg: string) {
  if (!/<svg[\s>]/i.test(svg)) throw new Error("render_svg needs one complete <svg> element.")
  const page = ensureWindow()
  await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(documentFor(svg))}`)
  const size = (await page.webContents.executeJavaScript(LAYOUT)) as { width: number; height: number } | undefined
  if (!size) throw new Error("The SVG didn't render: check that it is one well-formed <svg> element.")
  page.setContentSize(Math.ceil(size.width) + PADDING * 2, Math.ceil(size.height) + PADDING * 2)
  const inspection = (await page.webContents.executeJavaScript(INSPECT)) as Inspection
  const image = await page.webContents.capturePage({
    x: 0,
    y: 0,
    width: Math.ceil(size.width) + PADDING * 2,
    height: Math.ceil(size.height) + PADDING * 2,
  })
  return { text: report(inspection), image: image.toPNG().toString("base64") }
}

function ensureWindow() {
  if (window && !window.isDestroyed()) return window
  window = new BrowserWindow({
    show: false,
    width: CHAT_WIDTH + PADDING * 2,
    height: CHAT_MAX_HEIGHT + PADDING * 2,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  // The page only ever shows the markup it was given.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  return window
}

function documentFor(svg: string) {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"
  return [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<style>:root{${THEME};color-scheme:dark}html,body{margin:0;background:#242424;color:var(--tenon-fg);`,
    `font-family:Inter,"Segoe UI",system-ui,sans-serif}#stage{position:absolute;left:${PADDING}px;top:${PADDING}px}`,
    "#stage>svg{display:block;width:100%;height:100%}</style>",
    `</head><body><div id="stage">${svg}</div></body></html>`,
  ].join("")
}

// Sizes the stage as the chat would: the column's width, keeping the viewBox's aspect, at most 640px tall.
const LAYOUT = `(() => {
  const svg = document.querySelector("#stage > svg")
  if (!svg) return undefined
  const box = svg.viewBox && svg.viewBox.baseVal
  const w = box && box.width > 0 ? box.width : parseFloat(svg.getAttribute("width")) || ${CHAT_WIDTH}
  const h = box && box.height > 0 ? box.height : parseFloat(svg.getAttribute("height")) || 360
  if (!(box && box.width > 0)) svg.setAttribute("viewBox", "0 0 " + w + " " + h)
  let width = Math.min(${CHAT_WIDTH}, w), height = width * h / w
  if (height > ${CHAT_MAX_HEIGHT}) { height = ${CHAT_MAX_HEIGHT}; width = height * w / h }
  const stage = document.getElementById("stage")
  stage.style.width = width + "px"
  stage.style.height = height + "px"
  return { width, height }
})()`

// Measures labels in viewBox units: pairs that overlap, text past the shape it sits in or past the viewBox, and
// text that renders under 9px once the chat scales the diagram down.
const INSPECT = `(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const svg = document.querySelector("#stage > svg")
  const frame = svg.getBoundingClientRect()
  const box = svg.viewBox.baseVal
  const scale = frame.width / box.width
  const local = (r) => ({ x: (r.left - frame.left) / scale + box.x, y: (r.top - frame.top) / scale + box.y, w: r.width / scale, h: r.height / scale })
  const round = (n) => Math.round(n)
  const label = (t) => JSON.stringify(t.length > 48 ? t.slice(0, 47) + "…" : t)
  const texts = [...svg.querySelectorAll("text")]
    .map((el) => ({ text: (el.textContent || "").trim().replace(/\\s+/g, " "), box: local(el.getBoundingClientRect()), size: parseFloat(getComputedStyle(el).fontSize) || 16 }))
    .filter((t) => t.text && t.box.w > 0 && t.box.h > 0)
  const shapes = [...svg.querySelectorAll("rect, circle, ellipse, polygon")]
    .map((el) => local(el.getBoundingClientRect()))
    .filter((b) => b.w > 8 && b.h > 8 && b.w < box.width * 0.98)
  const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const issues = []
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j], shared = area(a.box, b.box)
      if (shared > 4 && shared > 0.1 * Math.min(a.box.w * a.box.h, b.box.w * b.box.h))
        issues.push({ kind: "overlap", message: "Labels overlap: " + label(a.text) + " and " + label(b.text) + " near (" + round(Math.max(a.box.x, b.box.x)) + ", " + round(Math.max(a.box.y, b.box.y)) + ")." })
    }
  for (const t of texts) {
    const b = t.box
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    const holder = shapes
      .filter((s) => cx > s.x && cx < s.x + s.w && cy > s.y && cy < s.y + s.h)
      .sort((p, q) => p.w * p.h - q.w * q.h)[0]
    if (holder && (b.x < holder.x - 2 || b.x + b.w > holder.x + holder.w + 2))
      issues.push({ kind: "overflow", message: "Text runs past its box: " + label(t.text) + " spans x " + round(b.x) + "–" + round(b.x + b.w) + " but the box spans x " + round(holder.x) + "–" + round(holder.x + holder.w) + "." })
    if (b.x < box.x - 1 || b.y < box.y - 1 || b.x + b.w > box.x + box.width + 1 || b.y + b.h > box.y + box.height + 1)
      issues.push({ kind: "clipped", message: "Cut off by the viewBox: " + label(t.text) + " spans x " + round(b.x) + "–" + round(b.x + b.w) + ", y " + round(b.y) + "–" + round(b.y + b.h) + " outside 0 0 " + round(box.width) + " " + round(box.height) + "." })
    if (t.size * scale < 9)
      issues.push({ kind: "small", message: "Too small to read: " + label(t.text) + " renders at " + (t.size * scale).toFixed(1) + "px; use a larger font or a narrower viewBox." })
  }
  return { width: round(frame.width), height: round(frame.height), issues: issues.slice(0, 30), total: issues.length }
})()`
