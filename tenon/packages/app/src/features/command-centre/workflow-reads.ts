import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { getSessionUsage } from "@/components/session/session-usage"
import { messageText, type CommandTranscript } from "@/features/command-centre/command-centre"
import { parseReports, runSpend, runThreads, type Report } from "@/features/command-centre/workflow-runs"

export function completedReports(data: CommandTranscript, sessionID: string, cache: Map<string, Report[]>) {
  return (data.message[sessionID] ?? []).flatMap((message) => {
    if (message.role !== "assistant" || message.time.completed === undefined) return []
    const known = cache.get(message.id)
    if (known) return known
    const reports = parseReports(messageText(data, message.id))
    cache.set(message.id, reports)
    return reports
  })
}

export function runUsage(
  sessions: ReadonlyArray<Pick<Session, "id" | "parentID" | "cost" | "tokens">>,
  messages: Record<string, ReadonlyArray<Message> | undefined>,
  rootID: string,
) {
  const family = new Set(runThreads(sessions, rootID))
  const priced = sessions.map((session) => ({
    id: session.id,
    parentID: session.parentID,
    cost: family.has(session.id) ? threadCost(session, messages[session.id]) : undefined,
  }))
  return {
    spent: runSpend(priced, rootID),
    reported: priced.some((session) => (session.cost ?? 0) > 0),
  }
}

function threadCost(session: Pick<Session, "cost">, messages: ReadonlyArray<Message> | undefined) {
  if (session.cost && session.cost > 0) return session.cost
  return getSessionUsage([...(messages ?? [])]).cost
}
