import { describe, expect, test } from "bun:test"
import { placePromptPopover } from "./popover-position"

const viewport = { width: 1024, height: 700 }

describe("placePromptPopover", () => {
  test("opens above a bottom-docked composer", () => {
    const place = placePromptPopover({ top: 520, bottom: 680, left: 360, width: 320 }, viewport)
    expect(place).toEqual({ left: 360, width: 320, bottom: 188, maxHeight: 320, side: "top" })
  })

  test("caps the height to the room above", () => {
    const place = placePromptPopover({ top: 250, bottom: 400, left: 0, width: 300 }, viewport)
    expect(place.side).toBe("top")
    expect(place.maxHeight).toBe(234)
    expect(place.left).toBe(8)
  })

  test("flips below when the composer sits near the top", () => {
    const place = placePromptPopover({ top: 60, bottom: 200, left: 100, width: 400 }, viewport)
    expect(place.side).toBe("bottom")
    expect(place.top).toBe(208)
    expect(place.maxHeight).toBe(320)
  })

  test("keeps the popover inside a narrow viewport", () => {
    const place = placePromptPopover({ top: 500, bottom: 600, left: 200, width: 600 }, { width: 500, height: 700 })
    expect(place.width).toBe(484)
    expect(place.left).toBe(8)
  })
})
