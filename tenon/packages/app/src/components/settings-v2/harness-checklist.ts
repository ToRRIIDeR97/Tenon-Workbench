import type { Harness } from "@tenon/schema/harness"

export type CheckStatus = "pass" | "fail" | "warn" | "waiting" | "running"
export type CheckRow = {
  id: "command" | "handshake" | "models" | "prompt" | "mcp" | "image" | "resume" | "platform"
  status: CheckStatus
  /** Required rows must pass before the harness can be saved; the others only inform. */
  required: boolean
  detail?: string
}

/**
 * The add-harness checklist from the two checks the server runs: discovery (handshake, session, models) and
 * verification (one real prompt). `stage` says which is running; `error` is the first failure's message.
 */
export function harnessChecklist(input: {
  stage: "idle" | "discover" | "verify" | "done"
  failedAt?: "discover" | "verify"
  error?: string
  discovery?: Harness.Discovery
  verification?: Harness.Verification
  platform: string
  /** Shown when the test prompt finished with no text. */
  emptyReply?: string
}): CheckRow[] {
  const found = input.discovery ?? input.verification
  const discoverFailed = input.failedAt === "discover"
  const waiting = (stage: "discover" | "verify"): CheckStatus => (input.stage === stage ? "running" : "waiting")
  const capabilities = input.verification?.capabilities
  const optional = (value: boolean | undefined): CheckStatus =>
    value === undefined ? (input.failedAt ? "waiting" : waiting("verify")) : value ? "pass" : "warn"
  return [
    {
      id: "command",
      required: true,
      status: found ? "pass" : discoverFailed ? "fail" : waiting("discover"),
      detail: found?.command ?? (discoverFailed ? input.error : undefined),
    },
    {
      id: "handshake",
      required: true,
      status: found ? "pass" : discoverFailed ? "fail" : waiting("discover"),
      detail: found ? [found.agentName, found.version].filter(Boolean).join(" ") || undefined : undefined,
    },
    {
      id: "models",
      required: false,
      status: found ? (found.models.length > 0 ? "pass" : "warn") : waiting("discover"),
      detail: found ? String(found.models.length) : undefined,
    },
    {
      id: "prompt",
      required: true,
      status: input.verification
        ? input.verification.ok
          ? "pass"
          : "fail"
        : input.failedAt === "verify"
          ? "fail"
          : waiting("verify"),
      detail:
        input.verification?.reply ||
        (input.verification ? input.emptyReply : input.failedAt === "verify" ? input.error : undefined),
    },
    { id: "mcp", required: false, status: optional(capabilities?.mcpHttp) },
    { id: "image", required: false, status: optional(capabilities?.image) },
    { id: "resume", required: false, status: optional(capabilities?.loadSession) },
    { id: "platform", required: false, status: found ? "pass" : "waiting", detail: input.platform },
  ]
}

/** Whether every required row passed. */
export const checklistPassed = (rows: ReadonlyArray<CheckRow>) =>
  rows.every((row) => !row.required || row.status === "pass")
