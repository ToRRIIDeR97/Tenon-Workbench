import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import type { IconProps } from "@tenon/ui/icon"

/** What a tool call did, independent of which harness named it. */
export type StepKind =
  | "read"
  | "search"
  | "edit"
  | "run"
  | "fetch"
  | "mcp"
  | "skill"
  | "subagent"
  | "todo"
  | "question"
  | "other"

export type Step = { kind: StepKind; target?: string }

export type TurnSteps = {
  counts: Partial<Record<StepKind, number>>
  /** Errored steps the agent caused; a call the user declined is counted in `declined` instead. */
  failed: number
  declined: number
  running: number
  durationMs?: number
}

type Options = { mcpServers?: readonly string[] }

// Built-in, Codex app-server (`command_execution`, …) and ACP (`acp_<kind>`) names.
const KINDS: Record<string, StepKind> = {
  read: "read",
  acp_read: "read",
  glob: "search",
  grep: "search",
  list: "search",
  codesearch: "search",
  acp_search: "search",
  edit: "edit",
  write: "edit",
  patch: "edit",
  apply_patch: "edit",
  multiedit: "edit",
  file_change: "edit",
  acp_edit: "edit",
  acp_delete: "edit",
  acp_move: "edit",
  bash: "run",
  shell: "run",
  command_execution: "run",
  acp_execute: "run",
  webfetch: "fetch",
  websearch: "fetch",
  web_search: "fetch",
  acp_fetch: "fetch",
  mcp_tool_call: "mcp",
  skill: "skill",
  task: "subagent",
  acp_subagent: "subagent",
  todowrite: "todo",
  question: "question",
}

// Kinds share an icon and a verb whichever harness ran the step; kinds are never colour-coded.
const ICONS: Record<StepKind, IconProps["name"]> = {
  read: "glasses",
  search: "magnifying-glass-menu",
  edit: "code-lines",
  run: "console",
  fetch: "window-cursor",
  mcp: "mcp",
  skill: "brain",
  subagent: "task",
  todo: "checklist",
  question: "bubble-5",
  other: "mcp",
}

// Subagent rows show the agent name when the caller knows it; this is the fallback.
const VERBS: Record<StepKind, string> = {
  read: "secondBrain.step.read",
  search: "secondBrain.step.searched",
  edit: "secondBrain.step.edited",
  run: "secondBrain.step.ran",
  fetch: "secondBrain.step.fetched",
  mcp: "secondBrain.step.called",
  skill: "secondBrain.step.loadedSkill",
  subagent: "ui.tool.agent.default",
  todo: "ui.tool.todos",
  question: "secondBrain.step.asked",
  other: "secondBrain.step.called",
}

export function stepOf(part: ToolPart, options?: Options): Step {
  return toolStep(part.tool, part.state.input, options)
}

/** `stepOf` for callers that hold a tool name and input rather than a part. */
export function toolStep(tool: string, input: Record<string, unknown> | undefined, options?: Options): Step {
  // An ACP agent reports Tenon's `ask_user` (and its own question tools) under a generic kind; the questions mark it.
  const kind = KINDS[tool] ?? (Array.isArray(input?.questions) ? "question" : undefined)
  if (kind) return withTarget(kind, targetOf(kind, input ?? {}))
  // MCP tools are named `sanitize(server) + "_" + tool` (tenon/src/mcp/catalog.ts), so match on the sanitized name.
  const server = options?.mcpServers?.find((name) => tool.startsWith(`${sanitize(name)}_`))
  if (server) return { kind: "mcp", target: `${server} · ${tool.slice(sanitize(server).length + 1)}` }
  // Other ACP tools arrive as `acp_<kind>`; the agent's title names the actual tool.
  return { kind: "other", target: (tool.startsWith("acp_") ? text(input?.title) : undefined) ?? tool }
}

/** i18n key for a step's verb, e.g. "Read", "Ran" or "Running". */
// Present-tense verbs for steps still in progress; kinds without one keep their regular verb.
const RUNNING_VERBS: Partial<Record<StepKind, string>> = {
  read: "secondBrain.step.reading",
  search: "secondBrain.step.searching",
  edit: "secondBrain.step.editing",
  run: "secondBrain.step.running",
  fetch: "secondBrain.step.fetching",
  mcp: "secondBrain.step.calling",
  skill: "secondBrain.step.loadingSkill",
  question: "secondBrain.step.asking",
  other: "secondBrain.step.calling",
}

export function stepVerbKey(kind: StepKind, running = false) {
  return (running && RUNNING_VERBS[kind]) || VERBS[kind]
}

export function stepIcon(kind: StepKind) {
  return ICONS[kind]
}

export function summarizeTurn(
  parts: readonly Part[],
  options?: Options & { startedAt?: number; endedAt?: number },
): TurnSteps {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  const counts = tools.reduce<Partial<Record<StepKind, number>>>((acc, part) => {
    const kind = stepOf(part, options).kind
    acc[kind] = (acc[kind] ?? 0) + 1
    return acc
  }, {})
  const declined = tools.filter(isDeclined).length
  // A call cut short by Stop is the user's choice too, so it isn't a failure either.
  const failed = tools.filter((part) => part.state.status === "error" && !isStopped(part)).length - declined
  const running = tools.filter((part) => part.state.status === "pending" || part.state.status === "running").length
  const durationMs =
    options?.startedAt !== undefined && options.endedAt !== undefined ? options.endedAt - options.startedAt : undefined
  return durationMs === undefined
    ? { counts, failed, declined, running }
    : { counts, failed, declined, running, durationMs }
}

// A declined permission reaches the part only as an errored call with the harness's wording: Tenon's own tools
// (core/src/v1/permission.ts, core/src/tool/tool.ts) and Claude Code over ACP. No structured flag survives.
const DECLINED = [/The user rejected permission to use this specific tool call/i, /The user declined this tool call/i]

/** Whether the user declined this tool call's permission, which is the user's choice rather than a failure. */
export function isDeclined(part: ToolPart) {
  const state = part.state
  if (state.status !== "error" || blockedBy(part)) return false
  return DECLINED.some((pattern) => pattern.test(state.error))
}

export type Blocked = { reason: "rules" | "error"; action: string }

/**
 * Why Tenon refused this call's permission without asking the user, when it did: a deny rule or a failed check.
 * The harness still reports it as declined, so core tags the result (`markBlocked` in core/src/harness.ts).
 */
export function blockedBy(part: ToolPart): Blocked | undefined {
  if (part.state.status !== "error") return undefined
  const blocked = part.state.metadata?.blocked
  if (typeof blocked !== "object" || blocked === null) return undefined
  const reason = "reason" in blocked ? blocked.reason : undefined
  const action = "action" in blocked ? blocked.action : undefined
  if ((reason !== "rules" && reason !== "error") || typeof action !== "string") return undefined
  return { reason, action }
}

// Core's runner fails a call left running when the turn is interrupted with this wording (runner/llm.ts).
const STOPPED = "Tool execution interrupted"

/** Whether this call was cut short because the turn was stopped, rather than failing on its own. */
export function isStopped(part: ToolPart) {
  return part.state.status === "error" && part.state.error === STOPPED
}

/**
 * A subagent's display name and type tag, from its tool input. The name is the task's description without a
 * trailing " (@type subagent)"; callers fall back to the tag, then a generic "Agent".
 */
export function subagentName(input: Record<string, unknown> | undefined): { name?: string; tag?: string } {
  const description = typeof input?.description === "string" ? input.description : ""
  const name = description.replace(/\s*\(@[^)]+ subagent\)\s*$/, "").trim() || undefined
  const tag = typeof input?.subagent_type === "string" ? input.subagent_type.trim() || undefined : undefined
  return { name, tag }
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function withTarget(kind: StepKind, target: string | undefined): Step {
  return target === undefined ? { kind } : { kind, target }
}

function targetOf(kind: StepKind, input: Record<string, unknown>) {
  if (kind === "read") return text(input.filePath, input.path, input.file_path, input.title)
  if (kind === "search") return text(input.pattern, input.query, input.path, input.title)
  if (kind === "edit") return text(input.filePath, input.path, firstChange(input.changes), input.title)
  if (kind === "run") return command(input.command) ?? text(input.title)
  if (kind === "fetch") return text(input.url, input.query, input.title)
  if (kind === "mcp") {
    const server = text(input.server)
    const tool = text(input.tool)
    return server && tool ? `${server} · ${tool}` : (tool ?? server)
  }
  if (kind === "skill") return text(input.name)
  if (kind === "subagent") return text(input.description)
  if (kind === "question" && Array.isArray(input.questions)) {
    const first: unknown = input.questions[0]
    return typeof first === "object" && first !== null && "question" in first ? text(first.question) : undefined
  }
  return undefined
}

function text(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0)
}

function command(value: unknown) {
  if (Array.isArray(value)) {
    const joined = value.filter((item): item is string => typeof item === "string").join(" ")
    return joined || undefined
  }
  return text(value)
}

/** Codex `fileChange` lists changes as an array of `{ path }` or an object keyed by path. */
function firstChange(changes: unknown) {
  if (Array.isArray(changes)) {
    const first = changes.find((item) => typeof item === "object" && item !== null && "path" in item)
    return text((first as { path?: unknown } | undefined)?.path)
  }
  if (typeof changes === "object" && changes !== null) return Object.keys(changes)[0]
  return undefined
}
