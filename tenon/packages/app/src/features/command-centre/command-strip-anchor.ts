import { createSignal } from "solid-js"

/**
 * Where the Command Centre handle sits on a thread: on the composer's top edge, centred on the chat column. The
 * composer region publishes it and the strip reads it into its own inline style. It used to be custom properties
 * on `<html>`; those inherit, so every write restyled and re-laid out the whole document, once per frame while the
 * side panel eased the thread column's width.
 */
export type CommandStripAnchor = {
  /** Distance from `main`'s bottom edge to the composer's top edge. */
  lift: number
  /** The composer's horizontal centre, from `main`'s left edge. */
  center: number
  /** The composer's width less 32px. */
  span: number
}

const [anchor, setAnchor] = createSignal<CommandStripAnchor | undefined>(undefined, {
  equals: (a, b) => a?.lift === b?.lift && a?.center === b?.center && a?.span === b?.span,
})

export const commandStripAnchor = anchor
export const setCommandStripAnchor = setAnchor

/** The strip's inline style: on the anchor when a thread's composer set one, else the page's bottom centre. */
export function commandStripStyle(value: CommandStripAnchor | undefined) {
  return {
    bottom: `calc(0.5rem + ${value?.lift ?? 0}px)`,
    left: value ? `${value.center}px` : "50%",
    width: value ? `${Math.min(640, value.span)}px` : "min(640px, calc(100% - 32px))",
  }
}
