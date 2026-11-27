export type AgentSection = "browser" | "device"

type MessageLike = {
  id: string
  role: string
  parentID?: string
  time: { created?: number; completed?: number }
  error?: unknown
}

export function activeTurn(messages: readonly MessageLike[]) {
  const running = messages.findLast(
    (message) => message.role === "assistant" && !message.time.completed && !message.error,
  )
  return running ? (running.parentID ?? running.id) : undefined
}

export function agentPanelOpener() {
  const opened = new Set<string>()
  return (turn: string | undefined, section: AgentSection) => {
    if (!turn) return false
    const key = `${turn}:${section}`
    if (opened.has(key)) return false
    opened.add(key)
    return true
  }
}
