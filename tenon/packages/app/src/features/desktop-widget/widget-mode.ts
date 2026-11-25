export type WidgetMode = "note" | "status" | "command"

export type WidgetModeState = {
  mode: WidgetMode
  since: number
  engaged: boolean
  typing: boolean
}

export const WIDGET_SETTLE_MS = 60_000

export function initialWidgetMode(now: number): WidgetModeState {
  return { mode: "note", since: now, engaged: false, typing: false }
}

export function widgetEvent(state: WidgetModeState, event: "status" | "reply", now: number): WidgetModeState {
  if (state.typing) return state
  return { ...state, mode: event === "status" ? "status" : "command", since: now }
}

export function pickWidgetMode(state: WidgetModeState, mode: WidgetMode, now: number): WidgetModeState {
  return { ...state, mode, since: now }
}

export function settleWidgetMode(state: WidgetModeState, now: number): WidgetModeState {
  if (state.mode === "note" || state.engaged || state.typing) return state
  if (now - state.since < WIDGET_SETTLE_MS) return state
  return { ...state, mode: "note", since: now }
}
