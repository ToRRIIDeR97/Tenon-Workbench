export const DESIGN_INSPECT = "tenon-design-inspect"

export type Rect = { x: number; y: number; width: number; height: number }
export type PickedDesignElement = { selector: string; tag: string; text: string; rect: Rect }

export const designInspectScript = `<script>
function tenonCssPath(el) {
  var parts = []
  var node = el
  while (node && node.tagName && node.tagName !== "BODY" && node.tagName !== "HTML" && parts.length < 5) {
    if (node.id) { parts.unshift("#" + node.id); break }
    var part = node.tagName.toLowerCase()
    var cls = node.classList && node.classList[0]
    if (cls) part += "." + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(cls) : cls)
    var parent = node.parentElement
    if (parent) {
      var same = []
      for (var i = 0; i < parent.children.length; i++) if (parent.children[i].tagName === node.tagName) same.push(parent.children[i])
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")"
    }
    parts.unshift(part)
    node = parent
  }
  return parts.join(" > ")
}
if (typeof document !== "undefined") (function () {
  var T = "${DESIGN_INSPECT}", on = false, last = null
  function box(el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } }
  function scroll() { return { x: window.scrollX, y: window.scrollY } }
  function send(message) { parent.postMessage(message, "*") }
  addEventListener("message", function (event) {
    if (event.source !== parent || !event.data || event.data.type !== T) return
    on = !!event.data.on
    last = null
    document.documentElement.style.cursor = on ? "crosshair" : ""
    if (!on) send({ type: T + ":hover" })
  })
  addEventListener("mousemove", function (event) {
    if (!on) return
    var el = document.elementFromPoint(event.clientX, event.clientY)
    if (!el || el === last) return
    last = el
    send({ type: T + ":hover", rect: box(el) })
  }, true)
  addEventListener("click", function (event) {
    if (!on || !(event.target instanceof Element)) return
    event.preventDefault()
    event.stopPropagation()
    var el = event.target
    send({ type: T + ":pick", selector: tenonCssPath(el), tag: el.tagName, text: String(el.innerText || el.textContent || "").slice(0, 400), rect: box(el), scroll: scroll() })
  }, true)
  addEventListener("scroll", function () { send({ type: T + ":scroll", scroll: scroll() }) }, { passive: true })
})()
</script>`

export function pickedDesignElement(data: unknown): PickedDesignElement | undefined {
  if (!isRecord(data) || data.type !== `${DESIGN_INSPECT}:pick`) return undefined
  if (typeof data.selector !== "string" || typeof data.tag !== "string" || typeof data.text !== "string")
    return undefined
  const rect = toRect(data.rect)
  const offset = toPoint(data.scroll)
  return {
    selector: data.selector.slice(0, 200),
    tag: data.tag.toLowerCase().slice(0, 40),
    text: data.text.replace(/\s+/g, " ").trim().slice(0, 120),
    rect: { ...rect, x: rect.x + offset.x, y: rect.y + offset.y },
  }
}

export function designInspectHover(data: unknown): Rect | null | undefined {
  if (!isRecord(data) || data.type !== `${DESIGN_INSPECT}:hover`) return undefined
  return data.rect === undefined ? null : toRect(data.rect)
}

export function designInspectScroll(data: unknown) {
  if (!isRecord(data) || data.type !== `${DESIGN_INSPECT}:scroll`) return undefined
  return toPoint(data.scroll)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

function toRect(value: unknown): Rect {
  const rect = isRecord(value) ? value : {}
  return {
    x: finite(rect.x),
    y: finite(rect.y),
    width: Math.max(0, finite(rect.width)),
    height: Math.max(0, finite(rect.height)),
  }
}

function toPoint(value: unknown) {
  const point = isRecord(value) ? value : {}
  return { x: finite(point.x), y: finite(point.y) }
}
