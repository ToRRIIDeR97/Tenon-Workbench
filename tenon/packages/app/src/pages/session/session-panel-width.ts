export const SESSION_PANEL_WIDTH_MIN = 450
export const SIDE_PANEL_WIDTH_MIN = 320
export const SIDE_PANEL_COLLAPSE_THRESHOLD = 240
export const SIDE_PANEL_WIDTH_SPLIT = 800

export function sidePanelWidthMax(available: number) {
  return Math.max(SIDE_PANEL_WIDTH_MIN, available - SESSION_PANEL_WIDTH_MIN)
}

export function clampSidePanelWidth(input: { width: number; available: number | undefined }) {
  const width = Math.max(SIDE_PANEL_WIDTH_MIN, input.width)
  if (input.available === undefined) return width
  return Math.min(width, sidePanelWidthMax(input.available))
}

export function reviewDiffStyle(input: { preferred: "unified" | "split"; width: number }) {
  return input.preferred === "split" && input.width >= SIDE_PANEL_WIDTH_SPLIT ? "split" : "unified"
}
