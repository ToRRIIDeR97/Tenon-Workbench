/**
 * Which face the desktop widget shows. It follows what happens: a status update (a thread needs you, finishes or
 * fails) turns it to Status, a Command Centre reply turns it to Command, and after a quiet minute it settles back
 * to Note. It never switches while you are typing in it, and hovering or focusing it holds the current face.
 */
export type WidgetMode = "note" | "status" | "command"

export type WidgetModeState = {
  mode: WidgetMode
  /** When the shown face last changed because of an event or a pick (ms). */
  since: number
  /** The pointer is over the widget, or focus is inside it. */
  engaged: boolean
  /** Text is being typed in the widget. */
  typing: boolean
}

/** How long a Status or Command face stays after its event before settling back to Note. */
export const WIDGET_SETTLE_MS = 60_000

export function initialWidgetMode(now: number): WidgetModeState {
  return { mode: "note", since: now, engaged: false, typing: false }
}

/** A status update or a reply: shows its face unless something is being typed. */
export function widgetEvent(state: WidgetModeState, event: "status" | "reply", now: number): WidgetModeState {
  if (state.typing) return state
  return { ...state, mode: event === "status" ? "status" : "command", since: now }
}

/** A face picked by hand from the widget's tabs. */
export function pickWidgetMode(state: WidgetModeState, mode: WidgetMode, now: number): WidgetModeState {
  return { ...state, mode, since: now }
}

/** Run on a timer: settles back to Note once the face has been quiet long enough and nobody is using it. */
export function settleWidgetMode(state: WidgetModeState, now: number): WidgetModeState {
  if (state.mode === "note" || state.engaged || state.typing) return state
  if (now - state.since < WIDGET_SETTLE_MS) return state
  return { ...state, mode: "note", since: now }
}
