import type { SessionStatus } from "@opencode-ai/sdk/v2/client"

export type AgentRunStatus = "approval" | "running" | "retrying"

/**
 * Live run state from the synced session status and pending permission requests.
 * Finished and failed runs both settle to `idle`, so an idle session has no status.
 */
export function agentRunStatus(status: SessionStatus | undefined, approvals: number): AgentRunStatus | undefined {
  if (approvals > 0) return "approval"
  if (status?.type === "busy") return "running"
  if (status?.type === "retry") return "retrying"
  return undefined
}

/**
 * How many things a session is waiting on the user for: pending approvals plus pending questions. A question
 * stops the agent as surely as an approval does, so both count as "needs you".
 */
export function needsYou(
  data: {
    permission: Record<string, ReadonlyArray<unknown> | undefined>
    question: Record<string, ReadonlyArray<unknown> | undefined>
  },
  sessionID: string,
) {
  return (data.permission[sessionID]?.length ?? 0) + (data.question[sessionID]?.length ?? 0)
}

/** Active runs first, keeping the incoming recency order inside each group. */
export function agentRuns<T>(records: T[], status: (record: T) => AgentRunStatus | undefined) {
  const runs = records.map((record) => ({ record, status: status(record) }))
  return [...runs.filter((run) => run.status), ...runs.filter((run) => !run.status)]
}
