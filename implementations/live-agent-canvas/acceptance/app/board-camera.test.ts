import { describe, expect, test } from "bun:test"
import { ARTBOARD, boardCamera, boardLayout, fitCamera, zoomAt } from "../../../../tenon/packages/app/src/pages/session/board-camera"

// AC-12: boards sit on a two-column grid of 1280×800 artboards, 200 apart.
describe("AC-12 boardLayout", () => {
  test("three boards", () => {
    expect(ARTBOARD).toEqual({ width: 1280, height: 800 })
    expect(boardLayout(3)).toEqual([
      { x: 0, y: 0, width: 1280, height: 800 },
      { x: 1480, y: 0, width: 1280, height: 800 },
      { x: 0, y: 1000, width: 1280, height: 800 },
    ])
  })
  test("none", () => expect(boardLayout(0)).toEqual([]))
})

// AC-13: the camera fits a rectangle, follows the board being drawn, otherwise shows them all.
describe("AC-13 camera", () => {
  const viewport = { width: 704, height: 600 }
  test("fitCamera centres the rectangle inside the padding", () => {
    const camera = fitCamera({ x: 0, y: 0, width: 1280, height: 800 }, viewport, 32)
    expect(camera.scale).toBeCloseTo(0.5)
    expect(camera.x).toBeCloseTo(32)
    expect(camera.y).toBeCloseTo(100)
  })
  test("follows the drawing board", () => {
    const layout = boardLayout(3)
    expect(boardCamera({ layout, drawing: 1, viewport })).toEqual(fitCamera(layout[1], viewport, 32))
  })
  test("overview when nothing draws", () => {
    const camera = boardCamera({ layout: boardLayout(3), viewport })
    expect(camera).toEqual(fitCamera({ x: 0, y: 0, width: 2760, height: 1800 }, viewport, 32))
  })
  test("no boards", () => expect(boardCamera({ layout: [], viewport })).toEqual({ x: 0, y: 0, scale: 1 }))
})

// AC-14: zooming keeps the point under the pointer still and stays within 5%–400%.
describe("AC-14 zoomAt", () => {
  test("keeps the anchor point fixed", () => {
    const camera = zoomAt({ x: 10, y: 20, scale: 0.5 }, 2, { x: 110, y: 120 })
    expect(camera.scale).toBe(1)
    expect(camera.x).toBe(-90)
    expect(camera.y).toBe(-80)
  })
  test("clamps", () => {
    expect(zoomAt({ x: 0, y: 0, scale: 3 }, 10, { x: 0, y: 0 }).scale).toBe(4)
    expect(zoomAt({ x: 0, y: 0, scale: 0.1 }, 0.01, { x: 0, y: 0 }).scale).toBe(0.05)
  })
})
