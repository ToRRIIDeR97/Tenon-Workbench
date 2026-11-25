import type { SessionStatus } from "@opencode-ai/sdk/v2/client"

export type AgentRunStatus = "approval" | "running" | "retrying"

export function agentRunStatus(status: SessionStatus | undefined, approvals: number): AgentRunStatus | undefined {
  if (approvals > 0) return "approval"
  if (status?.type === "busy") return "running"
  if (status?.type === "retry") return "retrying"
  return undefined
}

export function needsYou(
  data: {
    permission: Record<string, ReadonlyArray<unknown> | undefined>
    question: Record<string, ReadonlyArray<unknown> | undefined>
  },
  sessionID: string,
) {
  return (data.permission[sessionID]?.length ?? 0) + (data.question[sessionID]?.length ?? 0)
}

export function agentRuns<T>(records: T[], status: (record: T) => AgentRunStatus | undefined) {
  const runs = records.map((record) => ({ record, status: status(record) }))
  return [...runs.filter((run) => run.status), ...runs.filter((run) => !run.status)]
}
