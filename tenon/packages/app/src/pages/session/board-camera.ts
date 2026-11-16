/**
 * The Canvas board's geometry: designs are 1280×800 artboards on a grid in world space, and a camera
 * maps world to screen as `screen = world · scale + (x, y)`.
 */

export const ARTBOARD = { width: 1280, height: 800 }

export type Rect = { x: number; y: number; width: number; height: number }
export type Camera = { x: number; y: number; scale: number }
export type Size = { width: number; height: number }

const MIN_SCALE = 0.05
const MAX_SCALE = 4

/** Where each of `count` artboards sits: rows of `columns`, `gap` apart. */
export function boardLayout(count: number, options: { columns?: number; gap?: number } = {}): Rect[] {
  const columns = options.columns ?? 2
  const gap = options.gap ?? 200
  return Array.from({ length: count }, (_, index) => ({
    x: (index % columns) * (ARTBOARD.width + gap),
    y: Math.floor(index / columns) * (ARTBOARD.height + gap),
    width: ARTBOARD.width,
    height: ARTBOARD.height,
  }))
}

/** The camera that shows `rect` as large as fits inside `viewport` less `pad`, centred. */
export function fitCamera(rect: Rect, viewport: Size, pad = 32): Camera {
  const scale = Math.min((viewport.width - 2 * pad) / rect.width, (viewport.height - 2 * pad) / rect.height)
  return {
    x: (viewport.width - rect.width * scale) / 2 - rect.x * scale,
    y: (viewport.height - rect.height * scale) / 2 - rect.y * scale,
    scale,
  }
}

/** The board being drawn when there is one, otherwise every board. */
export function boardCamera(input: { layout: Rect[]; drawing?: number; viewport: Size; pad?: number }): Camera {
  const focus = input.drawing === undefined ? undefined : input.layout[input.drawing]
  if (focus) return fitCamera(focus, input.viewport, input.pad)
  if (input.layout.length === 0) return { x: 0, y: 0, scale: 1 }
  const left = Math.min(...input.layout.map((rect) => rect.x))
  const top = Math.min(...input.layout.map((rect) => rect.y))
  const right = Math.max(...input.layout.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...input.layout.map((rect) => rect.y + rect.height))
  return fitCamera({ x: left, y: top, width: right - left, height: bottom - top }, input.viewport, input.pad)
}

/** The camera part way from `from` to `to`, `progress` already eased (0–1). */
export function blendCamera(from: Camera, to: Camera, progress: number): Camera {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    scale: from.scale + (to.scale - from.scale) * progress,
  }
}

/**
 * A CSS easing token as a function of progress (0–1), for camera moves driven frame by frame:
 * `cubic-bezier(x1, y1, x2, y2)`, else linear.
 */
export function cssEasing(value: string) {
  const points = value
    .match(/cubic-bezier\(([^)]*)\)/)?.[1]
    ?.split(",")
    .map((part) => Number(part.trim()))
  if (!points || points.length !== 4 || !points.every(Number.isFinite)) return (progress: number) => progress
  const curve = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3
  return (progress: number) => {
    if (progress <= 0) return 0
    if (progress >= 1) return 1
    // Find t where the curve's x reaches `progress` by bisection, then read its y.
    const range = Array.from({ length: 24 }).reduce<[number, number]>(
      (bounds) => {
        const middle = (bounds[0] + bounds[1]) / 2
        return curve(points[0], points[2], middle) < progress ? [middle, bounds[1]] : [bounds[0], middle]
      },
      [0, 1],
    )
    return curve(points[1], points[3], (range[0] + range[1]) / 2)
  }
}

/** Zooms by `factor` (the scale kept within 5%–400%) so the world point under `point` stays put. */
export function zoomAt(camera: Camera, factor: number, point: { x: number; y: number }): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor))
  return {
    x: point.x - ((point.x - camera.x) / camera.scale) * scale,
    y: point.y - ((point.y - camera.y) / camera.scale) * scale,
    scale,
  }
}
