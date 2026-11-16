import { onCleanup } from "solid-js"

const EVENT = "tenon:titlebar-controls"

/** Left edge (CSS px) of the native Windows caption buttons; undefined where the window draws none. */
let controlsLeft: number | undefined

/** Published by the title bar on Windows, where the caption buttons float over the window's top-right corner. */
export function setTitlebarControlsLeft(value: number | undefined) {
  if (value === controlsLeft) return
  controlsLeft = value
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT))
}

/** How far a panel whose right edge is at `right` runs under caption buttons that start at `left`. */
export function capCut(right: number, left: number | undefined) {
  if (left === undefined || !Number.isFinite(left)) return 0
  return Math.max(0, Math.round(right - left))
}

/**
 * Ref for a `page-panel-cap`: sets `--tenon-cap-cut` to how far its title-bar band would run under the caption
 * buttons, so the band (and its edge hairline) stops where the buttons begin instead of cutting between them.
 */
export function panelCapRef(el: HTMLElement) {
  if (typeof window === "undefined" || typeof ResizeObserver === "undefined") return
  let last = -1
  const update = () => {
    if (!el.isConnected) return
    const cut = capCut(el.getBoundingClientRect().right, controlsLeft)
    if (cut === last) return
    last = cut
    el.style.setProperty("--tenon-cap-cut", `${cut}px`)
  }
  const observer = new ResizeObserver(update)
  observer.observe(el)
  window.addEventListener("resize", update)
  window.addEventListener(EVENT, update)
  onCleanup(() => {
    observer.disconnect()
    window.removeEventListener("resize", update)
    window.removeEventListener(EVENT, update)
  })
}
