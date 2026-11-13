/**
 * What the run tracker reads out of the synced store: the reports in a director thread's finished messages, and what
 * a run has cost. Both are plain functions of the synced data so they can be tested without a server.
 */
import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { getSessionUsage } from "@/components/session/session-usage"
import { messageText, type CommandTranscript } from "@/features/command-centre/command-centre"
import { parseReports, runSpend, runThreads, type Report } from "@/features/command-centre/workflow-runs"

/**
 * The reports in a thread's finished assistant messages, oldest first. A finished message is read and parsed once:
 * `cache` (by message ID) keeps its reports. A message still streaming is skipped until it completes, so a streamed
 * token neither reads its parts nor re-parses anything, and the user's messages are never read, so a report-shaped
 * line in the user's brief never counts.
 */
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

/**
 * What the thread `rootID` and every thread under it have cost, and whether any of them reported a cost. A thread's
 * cost is the session's own, or, when its info carries none, the sum of its loaded messages' costs
 * (`getSessionUsage`, the fallback `getSessionTotals` uses). `reported` is false when no thread of the run has a
 * cost, so a spend of 0 then means "unknown", not "nothing spent".
 */
export function runUsage(
  sessions: ReadonlyArray<Pick<Session, "id" | "parentID" | "cost" | "tokens">>,
  messages: Record<string, ReadonlyArray<Message> | undefined>,
  rootID: string,
) {
  const family = new Set(runThreads(sessions, rootID))
  const priced = sessions.map((session) => ({
    id: session.id,
    parentID: session.parentID,
    // Only the run's own threads are priced: reading the others' messages would be wasted work.
    cost: family.has(session.id) ? threadCost(session, messages[session.id]) : undefined,
  }))
  return {
    spent: runSpend(priced, rootID),
    reported: priced.some((session) => (session.cost ?? 0) > 0),
  }
}

// `getSessionTotals` drops the session's own cost when its info has no token totals, so the fallback it uses
// (`getSessionUsage`) is applied here directly: the session's cost when it has one, else its loaded messages' sum.
function threadCost(session: Pick<Session, "cost">, messages: ReadonlyArray<Message> | undefined) {
  if (session.cost && session.cost > 0) return session.cost
  return getSessionUsage([...(messages ?? [])]).cost
}
