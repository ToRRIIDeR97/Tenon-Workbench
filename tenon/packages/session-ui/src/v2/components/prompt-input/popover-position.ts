export type PromptPopoverPlacement = {
  left: number
  width: number
  bottom?: number
  top?: number
  maxHeight: number
  side: "top" | "bottom"
}

export function placePromptPopover(
  anchor: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number },
  options: { max?: number; gap?: number; margin?: number; min?: number } = {},
): PromptPopoverPlacement {
  const max = options.max ?? 320
  const gap = options.gap ?? 8
  const margin = options.margin ?? 8
  const min = options.min ?? 160
  const above = Math.max(0, anchor.top - gap - margin)
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  const side = above >= Math.min(max, min) || above >= below ? "top" : "bottom"
  const width = Math.max(0, Math.min(anchor.width, viewport.width - margin * 2))
  const left = Math.min(Math.max(anchor.left, margin), Math.max(margin, viewport.width - margin - width))
  const maxHeight = Math.min(max, side === "top" ? above : below)
  if (side === "top") return { left, width, bottom: viewport.height - anchor.top + gap, maxHeight, side }
  return { left, width, top: anchor.bottom + gap, maxHeight, side }
}
