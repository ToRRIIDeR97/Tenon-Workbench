import { createSignal } from "solid-js"

export type CommandStripAnchor = {
  lift: number
  center: number
  span: number
}

const [anchor, setAnchor] = createSignal<CommandStripAnchor | undefined>(undefined, {
  equals: (a, b) => a?.lift === b?.lift && a?.center === b?.center && a?.span === b?.span,
})

export const commandStripAnchor = anchor
export const setCommandStripAnchor = setAnchor

export function commandStripStyle(value: CommandStripAnchor | undefined) {
  return {
    bottom: `calc(0.5rem + ${value?.lift ?? 0}px)`,
    left: value ? `${value.center}px` : "50%",
    width: value ? `${Math.min(640, value.span)}px` : "min(640px, calc(100% - 32px))",
  }
}
