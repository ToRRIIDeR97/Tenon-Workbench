import { Show, createMemo } from "solid-js"
import type { Part, Session, ToolPart } from "@opencode-ai/sdk/v2"
import { Icon as StepIcon } from "@tenon/ui/icon"
import { stepIcon, stepOf, stepVerbKey, subagentName, toolStep } from "@tenon/session-ui/step-kind"
import { useLanguage } from "@/context/language"
import { createSessionContextFormatter } from "./session-context-format"
import { subagentDetail } from "./subagent-detail"

export interface LaneStep {
  readonly tool: string
  readonly title?: string
  readonly status: string
}

export interface Lane {
  readonly part: ToolPart
  readonly steps: LaneStep[]
  readonly running: boolean
  readonly failed: boolean
  /** The newest step still going, else the newest one, so the lane reads as "what it's doing now". */
  readonly current?: LaneStep
}

export const isSubagentPart = (part: Part): part is ToolPart => part.type === "tool" && stepOf(part).kind === "subagent"
export const subagentRunning = (part: ToolPart) => part.state.status === "pending" || part.state.status === "running"
const stepGoing = (step: LaneStep) => step.status === "pending" || step.status === "in_progress"

/** The child session a built-in `task` subagent runs in. */
export function taskSessionID(part: ToolPart) {
  if (part.tool !== "task") return undefined
  const metadata = ("metadata" in part.state ? part.state.metadata : undefined) ?? {}
  return typeof metadata.sessionId === "string" && metadata.sessionId ? metadata.sessionId : undefined
}

/** One lane for a subagent call. Without ACP steps, `childSteps` can supply a `task` agent's own tool calls. */
export function subagentLane(part: ToolPart, childSteps?: (part: ToolPart) => LaneStep[] | undefined): Lane {
  const acp = laneSteps(part.metadata?.acpSteps)
  const steps = acp.length > 0 ? acp : (childSteps?.(part) ?? [])
  return {
    part,
    steps,
    running: subagentRunning(part),
    failed: part.state.status === "error",
    current: steps.findLast(stepGoing) ?? steps.at(-1),
  }
}

/** Subagents started in the turn, with the steps an ACP harness reported for each one. */
export function subagentLanes(parts: readonly Part[], childSteps?: (part: ToolPart) => LaneStep[] | undefined) {
  return parts.filter(isSubagentPart).map((part) => subagentLane(part, childSteps))
}

export function laneSteps(value: unknown): LaneStep[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) =>
    typeof item === "object" && item !== null && typeof item.tool === "string" && typeof item.status === "string"
      ? [{ tool: item.tool, status: item.status, title: typeof item.title === "string" ? item.title : undefined }]
      : [],
  )
}

/** A child session's tool calls as lane steps, in ACP's status words. */
export function childLaneSteps(parts: readonly Part[]): LaneStep[] {
  return parts.flatMap((part) => {
    if (part.type !== "tool") return []
    const status = part.state.status
    return [
      {
        tool: part.tool,
        title: stepOf(part).target,
        status: status === "running" ? "in_progress" : status === "error" ? "failed" : status,
      },
    ]
  })
}

/** How long the subagent has run, or ran; undefined before it starts. */
export function laneElapsed(part: ToolPart, now: number) {
  const state = part.state
  if (state.status === "pending") return undefined
  const time = state.time as { start: number; end?: number }
  return Math.max(0, (time.end ?? now) - time.start)
}

/** Tokens the subagent used, from the ACP report or the `task` child session; undefined when nothing reported. */
export function laneTokens(part: ToolPart, child?: Pick<Session, "tokens">) {
  if (part.tool === "acp_subagent") {
    const usage = subagentDetail(part).usage
    if (usage.input === undefined && usage.output === undefined && usage.reasoning === undefined) return undefined
    return (usage.input ?? 0) + (usage.output ?? 0) + (usage.reasoning ?? 0)
  }
  const tokens = child?.tokens
  if (!tokens) return undefined
  const total = tokens.input + tokens.output + tokens.reasoning
  return total > 0 ? total : undefined
}

/**
 * One subagent as a lane: its task as the name with the agent type as a tag, the step count and elapsed time, a
 * thin bar (indeterminate while it runs, full once it ends) and a line for what it's doing now or how it ended.
 * Shared by the turn card and the Agents tab.
 */
export function SubagentLane(props: {
  lane: Lane
  now: number
  /** Formatted duration, e.g. "1m 4s"; the caller owns the duration copy. */
  formatDuration: (ms: number | undefined) => string | undefined
  tokens?: number
  onOpen?: () => void
  tabIndex?: number
}) {
  const language = useLanguage()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const named = createMemo(() => subagentName(props.lane.part.state.input))
  const name = () => named().name ?? named().tag ?? language.t("secondBrain.agentTab.agentFallback")
  const time = () => props.formatDuration(laneElapsed(props.lane.part, props.now))
  const status = () => (props.lane.failed ? "error" : props.lane.running ? "running" : "done")
  const error = () => (props.lane.part.state.status === "error" ? props.lane.part.state.error : undefined)

  const content = () => (
    <>
      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-0 truncate [font-weight:500]">{name()}</span>
        <Show when={named().name && named().tag}>
          {(tag) => (
            <span
              data-slot="subagent-lane-tag"
              class="shrink-0 rounded-full bg-v2-background-bg-base px-1.5 text-[11px] leading-4 text-v2-text-text-muted"
            >
              {tag()}
            </span>
          )}
        </Show>
        <span class="flex-1" />
        <Show when={props.lane.steps.length > 0}>
          <span class="shrink-0 tabular-nums text-[12px] text-v2-text-text-muted">
            {language.plural("secondBrain.turnSteps.laneSteps", props.lane.steps.length, {
              count: props.lane.steps.length.toLocaleString(language.intl()),
            })}
          </span>
        </Show>
        <Show when={props.lane.running && time()}>
          {(value) => (
            <span data-slot="subagent-lane-time" class="shrink-0 tabular-nums text-[12px] text-v2-text-text-muted">
              {value()}
            </span>
          )}
        </Show>
      </div>
      <div data-slot="turn-steps-lane-bar">
        <div data-slot="turn-steps-lane-fill" />
      </div>
      {/* One fixed line: what the agent is doing now, then how it ended, so the lane keeps its height. */}
      <Show
        when={props.lane.running}
        fallback={
          <div
            data-slot="subagent-lane-outcome"
            class="flex h-4 min-w-0 items-center gap-1.5 text-[12px] leading-4"
            classList={{
              "text-v2-text-text-critical": props.lane.failed,
              "text-v2-text-text-muted": !props.lane.failed,
            }}
          >
            <span class="shrink-0">
              {language.t(props.lane.failed ? "secondBrain.agents.failed" : "secondBrain.agents.done")}
            </span>
            <Show when={time()}>
              {(value) => (
                <>
                  <span aria-hidden="true">·</span>
                  <span class="shrink-0 tabular-nums">{value()}</span>
                </>
              )}
            </Show>
            <Show when={!props.lane.failed && props.tokens !== undefined}>
              <span aria-hidden="true">·</span>
              <span class="shrink-0 tabular-nums">
                {language.t("secondBrain.agents.tokens", { count: formatter().number(props.tokens) })}
              </span>
            </Show>
            <Show when={error()}>
              {(message) => (
                <>
                  <span aria-hidden="true">·</span>
                  <span class="min-w-0 truncate">{message()}</span>
                </>
              )}
            </Show>
          </div>
        }
      >
        <Show when={props.lane.current} keyed fallback={<div class="h-4" />}>
          {(step) => {
            const current = toolStep(step.tool, { title: step.title })
            return (
              <div
                data-slot="turn-steps-ticker-step"
                class="flex h-4 min-w-0 items-center gap-2 text-[12px] leading-4 text-v2-text-text-muted"
              >
                <StepIcon name={stepIcon(current.kind)} size="small" class="shrink-0" />
                <span class="shrink-0">{language.t(stepVerbKey(current.kind, stepGoing(step)))}</span>
                <Show when={current.target}>
                  {(target) => <span class="min-w-0 truncate font-mono">{target()}</span>}
                </Show>
              </div>
            )
          }}
        </Show>
      </Show>
    </>
  )

  return (
    <Show
      when={props.onOpen}
      fallback={
        <div
          data-slot="turn-steps-lane"
          data-running={props.lane.running ? "" : undefined}
          data-status={status()}
          class="flex flex-col gap-1"
        >
          {content()}
        </div>
      }
    >
      {(open) => (
        <button
          type="button"
          data-slot="turn-steps-lane"
          data-running={props.lane.running ? "" : undefined}
          data-status={status()}
          tabIndex={props.tabIndex}
          aria-label={language.t("secondBrain.agentTab.open", { agent: name() })}
          class="-mx-1.5 flex w-[calc(100%+12px)] flex-col gap-1 rounded-[8px] px-1.5 py-0.5 text-left transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
          onClick={() => open()()}
        >
          {content()}
        </button>
      )}
    </Show>
  )
}
