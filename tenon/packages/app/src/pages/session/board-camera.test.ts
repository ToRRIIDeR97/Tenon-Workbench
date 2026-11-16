import { describe, expect, test } from "bun:test"
import { blendCamera, boardCamera, boardColumns, boardLayout, cssEasing, zoomAt } from "./board-camera"

describe("board camera", () => {
  test("one board fills the view", () => {
    const viewport = { width: 704, height: 600 }
    expect(boardCamera({ layout: boardLayout(1), viewport })).toEqual(
      boardCamera({ layout: boardLayout(1), drawing: 0, viewport }),
    )
  })

  test("a drawing index past the boards shows them all", () => {
    const viewport = { width: 704, height: 600 }
    const layout = boardLayout(2)
    expect(boardCamera({ layout, drawing: 5, viewport })).toEqual(boardCamera({ layout, viewport }))
  })

  test("zoom in then out at the same point comes back", () => {
    const start = { x: 12, y: -40, scale: 0.4 }
    const back = zoomAt(zoomAt(start, 1.25, { x: 300, y: 200 }), 0.8, { x: 300, y: 200 })
    expect(back.x).toBeCloseTo(start.x)
    expect(back.y).toBeCloseTo(start.y)
    expect(back.scale).toBeCloseTo(start.scale)
  })

  test("columns follow the viewport's shape", () => {
    // The side panel at its default width: tall and narrow, so three boards stack.
    expect(boardColumns(3, { width: 400, height: 730 })).toBe(1)
    expect(boardColumns(3, { width: 1600, height: 500 })).toBe(3)
    expect(boardColumns(4, { width: 1200, height: 800 })).toBe(2)
    expect(boardColumns(1, { width: 400, height: 730 })).toBe(1)
    expect(boardColumns(3, { width: 0, height: 0 })).toBe(2)
    const viewport = { width: 400, height: 730 }
    const stacked = boardCamera({ layout: boardLayout(3, { columns: boardColumns(3, viewport) }), viewport })
    expect(stacked.scale).toBeGreaterThan(boardCamera({ layout: boardLayout(3), viewport }).scale)
  })

  test("blend moves part way", () => {
    expect(blendCamera({ x: 0, y: 0, scale: 1 }, { x: 10, y: 20, scale: 2 }, 0.5)).toEqual({ x: 5, y: 10, scale: 1.5 })
  })

  test("css easing reads cubic-bezier and falls back to linear", () => {
    const ease = cssEasing("cubic-bezier(0.05, 0.7, 0.1, 1)")
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    // Emphasized decelerate is well ahead of linear early on.
    expect(ease(0.25)).toBeGreaterThan(0.6)
    expect(cssEasing("cubic-bezier(0.42, 0, 0.58, 1)")(0.5)).toBeCloseTo(0.5, 3)
    expect(cssEasing("ease")(0.3)).toBe(0.3)
  })
})
