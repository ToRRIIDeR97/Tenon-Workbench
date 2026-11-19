type Timed = { role: string; time: { created: number; completed?: number } }

/**
 * How long one assistant message took, from its own start to its completion. Each row of a turn shows its own
 * time; the turn's total belongs to the turn steps card (#322).
 */
export function messageDurationMs(message: Timed) {
  if (message.role !== "assistant") return undefined
  const completed = message.time.completed
  if (typeof completed !== "number") return undefined
  const ms = completed - message.time.created
  return ms >= 0 ? ms : undefined
}

/**
 * Whether a tool call was ended by the user's Stop on computer use (#333): the Cua Driver proxy's own wording
 * (`core/src/harness/computer-proxy.ts`) for the call Stop cut off.
 */
export function stoppedComputerUse(state: { status: string; error?: unknown; output?: unknown }) {
  const text = state.status === "error" ? state.error : state.status === "completed" ? state.output : undefined
  return typeof text === "string" && text.includes("the user shut computer use down with Stop")
}

/**
 * How long one finished tool call took, from its state's own start and end. Calls under a second show no time,
 * like the rows of the turn steps card.
 */
export function toolDurationMs(state: { status: string; time?: { start?: number; end?: number } }) {
  if (state.status !== "completed" && state.status !== "error") return undefined
  const start = state.time?.start
  const end = state.time?.end
  if (typeof start !== "number" || typeof end !== "number") return undefined
  const ms = end - start
  return ms >= 1000 ? ms : undefined
}
