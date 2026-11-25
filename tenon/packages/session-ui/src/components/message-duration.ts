type Timed = { role: string; time: { created: number; completed?: number } }

export function messageDurationMs(message: Timed) {
  if (message.role !== "assistant") return undefined
  const completed = message.time.completed
  if (typeof completed !== "number") return undefined
  const ms = completed - message.time.created
  return ms >= 0 ? ms : undefined
}

export function stoppedComputerUse(state: { status: string; error?: unknown; output?: unknown }) {
  const text = state.status === "error" ? state.error : state.status === "completed" ? state.output : undefined
  return typeof text === "string" && text.includes("the user shut computer use down with Stop")
}

export function toolDurationMs(state: { status: string; time?: { start?: number; end?: number } }) {
  if (state.status !== "completed" && state.status !== "error") return undefined
  const start = state.time?.start
  const end = state.time?.end
  if (typeof start !== "number" || typeof end !== "number") return undefined
  const ms = end - start
  return ms >= 1000 ? ms : undefined
}
