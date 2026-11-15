import { describe, expect, test } from "bun:test"
import { WIDGET_SETTLE_MS, initialWidgetMode, pickWidgetMode, settleWidgetMode, widgetEvent } from "./widget-mode"

describe("widget mode", () => {
  test("starts on Note", () => {
    expect(initialWidgetMode(0).mode).toBe("note")
  })

  test("a status update shows Status and a reply shows Command", () => {
    const status = widgetEvent(initialWidgetMode(0), "status", 10)
    expect(status).toMatchObject({ mode: "status", since: 10 })
    expect(widgetEvent(status, "reply", 20)).toMatchObject({ mode: "command", since: 20 })
  })

  test("never switches while something is being typed", () => {
    const typing = { ...initialWidgetMode(0), typing: true }
    expect(widgetEvent(typing, "reply", 5)).toBe(typing)
    expect(settleWidgetMode({ ...typing, mode: "command" }, WIDGET_SETTLE_MS * 2).mode).toBe("command")
  })

  test("settles back to Note after a quiet minute, unless it is in use", () => {
    const shown = widgetEvent(initialWidgetMode(0), "status", 0)
    expect(settleWidgetMode(shown, WIDGET_SETTLE_MS - 1).mode).toBe("status")
    expect(settleWidgetMode(shown, WIDGET_SETTLE_MS)).toMatchObject({ mode: "note", since: WIDGET_SETTLE_MS })
    expect(settleWidgetMode({ ...shown, engaged: true }, WIDGET_SETTLE_MS * 3).mode).toBe("status")
  })

  test("a face picked by hand restarts the quiet minute", () => {
    const picked = pickWidgetMode(initialWidgetMode(0), "command", 100)
    expect(settleWidgetMode(picked, 100 + WIDGET_SETTLE_MS - 1).mode).toBe("command")
    expect(settleWidgetMode(picked, 100 + WIDGET_SETTLE_MS).mode).toBe("note")
  })
})
