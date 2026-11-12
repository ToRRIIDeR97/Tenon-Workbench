import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { Part, ReasoningPart, ToolPart } from "@opencode-ai/sdk/v2"
import { Icon } from "@tenon/ui/v2/icon"
import { LoaderV2 } from "@tenon/ui/v2/loader-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { ScrollView } from "@tenon/ui/scroll-view"
import { TextShimmer } from "@tenon/ui/text-shimmer"
import { Icon as StepIcon } from "@tenon/ui/icon"
import {
  blockedBy,
  isDeclined,
  isStopped,
  stepIcon,
  stepOf,
  stepVerbKey,
  summarizeTurn,
  subagentName,
  type StepKind,
  type TurnSteps,
} from "@tenon/session-ui/step-kind"
import { Markdown } from "@tenon/session-ui/markdown"
import { readPartText } from "@tenon/session-ui/message-part-text"
import { useData } from "@tenon/session-ui/context"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { DiffChanges } from "@tenon/ui/diff-changes"
import { useFileComponent } from "@tenon/ui/context/file"
import { Dynamic } from "solid-js/web"
import { editDiffs } from "./step-diff"
import { workspaceRelative } from "./step-path"
import { SubagentLane, childLaneSteps, laneTokens, subagentLanes, taskSessionID } from "./subagent-lane"
import "./turn-steps-summary.css"

// Fixed order so the phrase list doesn't reshuffle while a turn streams.
const KIND_ORDER: StepKind[] = [
  "read",
  "search",
  "edit",
  "run",
  "fetch",
  "mcp",
  "skill",
  "subagent",
  "todo",
  "question",
  "other",
]

/** One complete localized phrase per step kind that occurred, e.g. "Read 3 files". */
export function stepCountPhrases(language: ReturnType<typeof useLanguage>, counts: TurnSteps["counts"]) {
  return stepCounts(counts).map((item) => stepCountPhrase(language, item.kind, item.count))
}

function stepCounts(counts: TurnSteps["counts"]) {
  return KIND_ORDER.flatMap((kind) => {
    const count = counts[kind]
    return count ? [{ kind, count }] : []
  })
}

function stepCountPhrase(language: ReturnType<typeof useLanguage>, kind: StepKind, count: number) {
  return language.plural(`secondBrain.turnSteps.${kind}`, count, { count: count.toLocaleString(language.intl()) })
}

/**
 * How long a turn took: from the user's message to the last assistant message's completion. It comes from message
 * times rather than the parts a card shows, so it doesn't change with which parts are visible (reasoning shown or
 * hidden), and the live counter, the card and the turn footer agree.
 */
export function turnDuration(created: number | undefined, completed: readonly (number | undefined)[]) {
  const ends = completed.filter((value): value is number => typeof value === "number")
  if (created === undefined || ends.length === 0) return undefined
  const end = Math.max(...ends)
  return end < created ? undefined : end - created
}

/** Whether a card has anything to show: a tool step, or a reasoning note with text. */
export function hasVisibleSteps(parts: readonly Part[], text: (part: ReasoningPart) => string | undefined) {
  return parts.some((part) => part.type === "tool" || (part.type === "reasoning" && !!text(part)?.trim()))
}

/** How long the open card takes to fold, from its height: 300 ms for a few rows, up to 700 ms for a long list. */
export function foldDuration(height: number) {
  return Math.round(Math.min(700, Math.max(300, 220 + height * 0.5)))
}

const GROUPED = new Set<StepKind>(["read", "search", "edit", "run", "fetch"])
const isRunning = (part: ToolPart) => part.state.status === "pending" || part.state.status === "running"
// A call the user declined or stopped errored, but it's the user's choice, so it reads muted rather than red.
const isFailed = (part: ToolPart) => part.state.status === "error" && !isDeclined(part) && !isStopped(part)

/** The note on a step Tenon blocked without asking the user, saying why; the harness calls it declined. */
export function blockedNote(part: ToolPart) {
  const blocked = blockedBy(part)
  if (!blocked) return undefined
  const key =
    blocked.reason === "rules" ? "secondBrain.turnSteps.blockedByRules" : "secondBrain.turnSteps.blockedByError"
  return { key, action: blocked.action } as const
}

const isSubagent = (part: ToolPart) => stepOf(part).kind === "subagent"
// Paths, patterns, commands and URLs read as code; a question or an agent's task reads as prose.
const codeTarget = (kind: StepKind) =>
  kind === "read" || kind === "search" || kind === "edit" || kind === "run" || kind === "fetch"
const isThinking = (part: ReasoningPart) => part.time?.end === undefined
const stepRunning = (part: ToolPart | ReasoningPart) => (part.type === "tool" ? isRunning(part) : isThinking(part))

/**
 * The step the ticker shows: the latest one still in progress, else the latest one. A reasoning part counts as a
 * step, so the agent's thinking reads as a line in the card. Subagents have lanes instead.
 */
export function tickerStep(parts: readonly Part[]) {
  const steps = parts.filter(
    (part): part is ToolPart | ReasoningPart =>
      (part.type === "tool" && !isSubagent(part)) || part.type === "reasoning",
  )
  return steps.findLast(stepRunning) ?? steps.at(-1)
}

/**
 * What a reasoning summary is on now, for the ticker: its latest heading or bold title line, else the first
 * sentence of its latest paragraph. Harnesses that send plain prose change topic paragraph by paragraph.
 */
export function reasoningTopic(text: string) {
  const markdown = text.replace(/\r\n?/g, "\n")
  const title = markdown
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => /^#{1,6}\s+\S/.test(line) || /^\*\*[^*]+\*\*:?$/.test(line))
  if (title) return plain(title)
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .findLast(Boolean)
  return paragraph ? plain(paragraph.split(/(?<=[.!?])\s+/)[0] ?? paragraph) : undefined
}

function plain(value: string) {
  return (
    value
      .replace(/^#{1,6}\s+/, "")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .replace(/:$/, "")
      .trim() || undefined
  )
}

/**
 * Keeps the row the user clicked where it is on screen while the card grows or shrinks around it. The timeline
 * otherwise keeps whatever lies below steady, so a card whose header has scrolled off the top grows upward.
 */
function keepInPlace(element: Element) {
  const scroller = scrollParent(element)
  if (!scroller) return
  // The browser's scroll anchoring would hold content below the card steady and grow the card upward; turn it off
  // while the card animates, then correct any drift the list's own measuring causes.
  // Pausing auto-scroll sets the property again right after the click, so it's re-applied every frame and the
  // last value anyone else set comes back at the end.
  let anchoring = scroller.style.overflowAnchor
  const suppress = () => {
    if (scroller.style.overflowAnchor === "none") return
    anchoring = scroller.style.overflowAnchor
    scroller.style.overflowAnchor = "none"
  }
  suppress()
  const start = element.getBoundingClientRect().top
  const until = performance.now() + 700
  const step = () => {
    if (!element.isConnected) return
    suppress()
    const drift = element.getBoundingClientRect().top - start
    if (Math.abs(drift) >= 1) scroller.scrollTop += drift
    if (performance.now() < until) return requestAnimationFrame(step)
    scroller.style.overflowAnchor = anchoring
  }
  requestAnimationFrame(step)
}

function scrollParent(element: Element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node
  }
  return undefined
}

/** What an open step row shows: the error, or a command with its output, or the tool's output. */
export function toolDetail(part: ToolPart) {
  const state = part.state
  if (state.status === "error") return state.error
  // A running command streams its output through metadata, so an open row shows it live.
  const raw =
    state.status === "completed"
      ? state.output
      : state.status === "running" && typeof state.metadata?.output === "string"
        ? state.metadata.output
        : undefined
  if (raw === undefined) return undefined
  // Escape sequences from terminals; the row is plain text.
  // oxlint-disable-next-line no-control-regex
  const output = raw
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .trim()
    .slice(0, 20_000)
  const step = stepOf(part)
  if (step.kind === "run" && step.target) return output ? `$ ${step.target}\n\n${output}` : `$ ${step.target}`
  return output || undefined
}

export { subagentLanes, type LaneStep } from "./subagent-lane"

export function formatTurnDuration(language: ReturnType<typeof useLanguage>, ms: number | undefined) {
  if (ms === undefined || !(ms >= 0)) return
  const total = Math.round(ms / 1000)
  const number = (value: number) => value.toLocaleString(language.intl())
  if (total < 60) return language.t("ui.message.duration.seconds", { count: number(total) })
  return language.t("ui.message.duration.minutesSeconds", {
    minutes: number(Math.floor(total / 60)),
    seconds: number(total % 60),
  })
}

export function TurnStepsSummary(props: {
  parts: Part[]
  working: boolean
  startedAt?: number
  durationMs?: number
  open: boolean
  onToggle: (open: boolean) => void
  /** Called before a row inside the open card opens or closes, which changes the card's height. */
  onResize?: () => void
  /**
   * Opens the side panel's Agents tab, on the given subagent or on the list without one. Lanes become buttons and
   * the lanes block gets an "Agents" link when this is set.
   */
  onOpenSubagent?: (part?: ToolPart) => void
  /**
   * "grouped" (default) is one card whose same-kind steps merge into one row. "rows" lists each step as its own
   * line straight in the thread while the card works, the current one highlighted, then folds into the card.
   */
  layout?: "grouped" | "rows"
}) {
  const language = useLanguage()
  const settings = useSettings()
  const summary = createMemo(() => summarizeTurn(props.parts))
  const counts = createMemo(() => stepCounts(summary().counts))
  // Working in the "rows" layout there is no card: no header, and the steps always show.
  const transcript = () => props.layout === "rows" && props.working
  const shown = () => transcript() || props.open
  const live = () => props.working && !shown()
  const data = useData()
  const fileComponent = useFileComponent()
  // A new value whenever the step or the reasoning topic changes, so the keyed ticker slides the new line in.
  const ticker = createMemo(
    () => {
      const part = live() ? tickerStep(props.parts) : undefined
      if (!part) return undefined
      if (part.type === "tool") return { part }
      return { part, topic: reasoningTopic(readPartText(data.store.part_text_accum_delta, part)) }
    },
    undefined,
    { equals: (a, b) => a?.part === b?.part && a?.topic === b?.topic },
  )
  // Finished lanes stay, with a full bar, until the turn ends so parallel subagents don't jump around.
  // A `task` agent's steps are its child session's tool calls, when that session is loaded.
  const childParts = (sessionID: string) =>
    (data.store.message[sessionID] ?? []).flatMap((message) => data.store.part[message.id] ?? [])
  const childSteps = (part: ToolPart) => {
    const id = taskSessionID(part)
    return id ? childLaneSteps(childParts(id)) : undefined
  }
  const lanes = createMemo(() => (live() ? subagentLanes(props.parts, childSteps) : []))
  const childSession = (part: ToolPart) => {
    const id = taskSessionID(part)
    return id ? data.store.session.find((session) => session.id === id) : undefined
  }
  // The body's rows mount on first open and stay, so closing animates instead of emptying at once.
  const [body, setBody] = createStore({
    mounted: shown(),
    // Set once the card opens while on screen: the timeline remounts rows on scroll, and an open card coming back
    // into view shouldn't replay its entrance.
    animate: false,
    expanded: {} as Record<string, boolean>,
    seen: {} as Record<string, boolean>,
  })
  let bodyEl: HTMLDivElement | undefined
  createEffect(
    on(
      () => shown(),
      (open, previous) => {
        if (open) setBody("mounted", true)
        if (open && previous === false) setBody("animate", true)
        // A taller card takes longer to fold, so a long list doesn't snap shut. Set before the frame paints, so the
        // transition that starts from this change already uses it.
        const rows = bodyEl?.querySelector<HTMLElement>('[data-slot="turn-steps-rows"]')
        if (!open && previous && rows)
          bodyEl?.style.setProperty("--turn-steps-close", `${foldDuration(rows.scrollHeight)}ms`)
      },
    ),
  )
  // Rows built a frame or more after the body mounted are steps that just arrived, and slide in. Rows built with the
  // body (its first open, or the timeline remounting the card on scroll) don't, so nothing replays.
  const [arriving, setArriving] = createSignal(false)
  createEffect(() => {
    if (!body.mounted) return
    const frame = requestAnimationFrame(() => setArriving(true))
    onCleanup(() => cancelAnimationFrame(frame))
  })
  const fresh = () => (untrack(arriving) ? "" : undefined)
  const toggle = (id: string, anchor: Element, open = !!body.expanded[id]) => {
    props.onResize?.()
    keepInPlace(anchor)
    if (body.seen[id] || open) {
      setBody("seen", id, true)
      return setBody("expanded", id, !open)
    }
    // First open: mount the panel closed, then open it a frame later so it grows instead of appearing.
    setBody("seen", id, true)
    requestAnimationFrame(() => setBody("expanded", id, true))
  }
  // One clock drives the turn and step timers; it only ticks while the turn works.
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!props.working) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const elapsed = (start: number | undefined) =>
    start === undefined ? undefined : formatTurnDuration(language, Math.max(0, now() - start))
  const title = () => {
    if (props.working) {
      const duration = elapsed(props.startedAt)
      return duration
        ? language.t("secondBrain.turnSteps.workingFor", { duration })
        : language.t("secondBrain.turnSteps.working")
    }
    const duration = formatTurnDuration(language, props.durationMs)
    if (!duration) return language.t("secondBrain.turnSteps.workedNoDuration")
    return language.t("secondBrain.turnSteps.worked", { duration })
  }

  const label = (part: ToolPart) => {
    const step = stepOf(part)
    // Subagent rows show the agent's task, else its type, which are data rather than copy.
    if (step.kind === "subagent") {
      const named = subagentName(part.state.input)
      const name = named.name ?? named.tag
      if (name) return name
    }
    return language.t(stepVerbKey(step.kind, isRunning(part)))
  }
  // A subagent row's task is already its label, so the agent type takes the target's place.
  const rowTarget = (part: ToolPart) => {
    const step = stepOf(part)
    if (step.kind !== "subagent") return step.target
    const named = subagentName(part.state.input)
    return named.name ? named.tag : undefined
  }
  // Paths read relative to the workspace; the full target stays in the tooltip.
  const shortTarget = (target: string) => workspaceRelative(target, data.directory)
  const fullTitle = (target: string) => (shortTarget(target) === target ? undefined : target)
  // The "Expand shell/edit tool parts" settings open those steps until the user toggles them.
  const startsOpen = (part: ToolPart) => {
    const kind = stepOf(part).kind
    if (kind === "run") return settings.general.shellToolPartsExpanded()
    if (kind === "edit") return settings.general.editToolPartsExpanded()
    return false
  }
  const openable = (part: ToolPart) => (part.tool === "acp_subagent" ? props.onOpenSubagent : undefined)
  const startOf = (part: ToolPart) => (part.state.status === "running" ? part.state.time.start : undefined)
  // Finished steps show how long they took, from a second up.
  const tookOf = (part: ToolPart) => {
    const state = part.state
    if (state.status !== "completed" && state.status !== "error") return undefined
    const ms = state.time.end - state.time.start
    return ms >= 1000 ? formatTurnDuration(language, ms) : undefined
  }

  // One step: a tool row that opens to its output, or a reasoning note that opens to its full text.
  const stepRow = (part: Part, index: number) => (
    <>
      <Show when={part.type === "tool" ? part : undefined}>
        {(tool) => {
          const detail = createMemo(() => toolDetail(tool()))
          // An edit opens to its diff instead of the tool's "applied" text.
          const diffs = createMemo(() => editDiffs(tool()))
          const expandable = () => diffs().length > 0 || !!detail()
          const open = () => body.expanded[tool().id] ?? (expandable() && startsOpen(tool()))
          const mounted = () => body.seen[tool().id] || open()
          const step = () => stepOf(tool())
          return (
            <div
              data-slot="turn-steps-item"
              data-timeline-part-id={tool().id}
              data-new={fresh()}
              style={{ "--i": index }}
              class="flex min-w-0 flex-col"
            >
              <button
                type="button"
                data-slot="turn-steps-row"
                data-running={isRunning(tool()) ? "" : undefined}
                tabIndex={shown() ? 0 : -1}
                aria-expanded={expandable() ? open() : undefined}
                class="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-[12px] bg-v2-background-bg-layer-02 px-2.5 py-1.5 text-left text-[13px] leading-5 text-v2-text-text-base transition-colors hover:bg-v2-background-bg-layer-03 focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                onClick={(event) => {
                  const opener = openable(tool())
                  if (opener) return opener(tool())
                  if (expandable()) toggle(tool().id, event.currentTarget, open())
                }}
              >
                <StepIcon name={stepIcon(step().kind)} size="small" class="shrink-0 text-v2-text-text-muted" />
                <span class="shrink-0 [font-weight:500]" classList={{ "text-v2-text-text-critical": isFailed(tool()) }}>
                  {label(tool())}
                </span>
                <Show when={rowTarget(tool())}>
                  {(target) => (
                    <span
                      class="min-w-0 truncate text-v2-text-text-muted"
                      classList={{ "font-mono text-[12px]": codeTarget(step().kind) }}
                      title={fullTitle(target())}
                    >
                      {shortTarget(target())}
                    </span>
                  )}
                </Show>
                <span class="flex-1" />
                <Show when={isDeclined(tool())}>
                  <span data-slot="turn-steps-declined" class="shrink-0 text-[12px] text-v2-text-text-muted">
                    {language.t("secondBrain.turnSteps.declinedStep")}
                  </span>
                </Show>
                <Show when={blockedNote(tool())}>
                  {(note) => (
                    <span data-slot="turn-steps-blocked" class="shrink-0 text-[12px] text-v2-text-text-muted">
                      {language.t(note().key, { action: note().action })}
                    </span>
                  )}
                </Show>
                <Show when={isStopped(tool())}>
                  <span data-slot="turn-steps-stopped" class="shrink-0 text-[12px] text-v2-text-text-muted">
                    {language.t("secondBrain.turnSteps.stoppedStep")}
                  </span>
                </Show>
                <Show when={isRunning(tool())}>
                  <LoaderV2 width={12} height={12} class="shrink-0 text-v2-icon-icon-accent" />
                </Show>
                <Show when={diffs().length > 0}>
                  <DiffChanges changes={diffs()} class="shrink-0 text-[12px]" />
                </Show>
                <Show when={tookOf(tool())}>
                  {(took) => <span class="shrink-0 tabular-nums text-[12px] text-v2-text-text-muted">{took()}</span>}
                </Show>
                <Show when={expandable() || openable(tool())}>
                  <Icon
                    name="chevron-right"
                    size="small"
                    class="shrink-0 text-v2-text-text-muted transition-transform motion-reduce:transition-none"
                    classList={{ "rotate-90 rtl:-rotate-90": open() }}
                  />
                </Show>
              </button>
              {/* Mounted on first open and kept, so closing animates like the card itself. */}
              <Show when={mounted() && diffs().length > 0}>
                <div data-slot="turn-steps-reveal" data-open={open() ? "" : undefined}>
                  <div>
                    <ScrollView
                      data-slot="turn-steps-detail"
                      class="mt-1 max-h-96 rounded-[10px] bg-v2-background-bg-base"
                    >
                      <For each={diffs()}>
                        {(diff) => (
                          <div data-slot="turn-steps-diff" class="flex min-w-0 flex-col">
                            {/* Several files in one patch each get their name above their diff. */}
                            <Show when={diffs().length > 1}>
                              <div class="flex min-w-0 items-center gap-2 px-3 pt-2 text-[12px] text-v2-text-text-muted">
                                <span class="min-w-0 truncate font-mono" title={fullTitle(diff.file)}>
                                  {shortTarget(diff.file)}
                                </span>
                                <DiffChanges changes={diff} class="shrink-0" />
                              </div>
                            </Show>
                            <Dynamic component={fileComponent} mode="diff" fileDiff={diff.fileDiff} />
                          </div>
                        )}
                      </For>
                    </ScrollView>
                  </div>
                </div>
              </Show>
              <Show when={mounted() && diffs().length === 0 ? detail() : undefined}>
                {(text) => (
                  <div data-slot="turn-steps-reveal" data-open={open() ? "" : undefined}>
                    <div>
                      <ScrollView
                        data-slot="turn-steps-detail"
                        class="mt-1 max-h-60 rounded-[10px] bg-v2-background-bg-base"
                      >
                        <pre class="m-0 whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12px] leading-[18px] text-v2-text-text-muted">
                          {text()}
                        </pre>
                      </ScrollView>
                    </div>
                  </div>
                )}
              </Show>
            </div>
          )
        }}
      </Show>
      <Show when={part.type === "reasoning" ? part : undefined}>
        {(note) => {
          const text = () => readPartText(data.store.part_text_accum_delta, note())
          const open = () => !!body.expanded[note().id]
          return (
            <Show when={text()}>
              <div
                data-slot="turn-steps-note"
                data-new={fresh()}
                data-running={isThinking(note()) ? "" : undefined}
                style={{ "--i": index }}
                role="button"
                tabIndex={shown() ? 0 : -1}
                aria-expanded={open()}
                class="flex w-full min-w-0 items-start gap-2 rounded-[12px] px-2.5 py-1 text-[13px] leading-5 text-v2-text-text-muted transition-colors select-text hover:bg-v2-background-bg-layer-02 focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                onClick={(event) => {
                  // Selecting text to copy it shouldn't fold the note.
                  if (window.getSelection()?.toString()) return
                  toggle(note().id, event.currentTarget)
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  toggle(note().id, event.currentTarget)
                }}
              >
                <StepIcon name="brain" size="small" class="mt-0.5 shrink-0" />
                {/* One block clipped to its first line when folded, so opening grows it smoothly. */}
                <div data-slot="turn-steps-note-text" data-open={open() ? "" : undefined} class="min-w-0 flex-1">
                  <Markdown text={text()} class="text-[13px] leading-5" />
                </div>
              </div>
            </Show>
          )
        }}
      </Show>
    </>
  )
  // A run of same-kind steps ("Read 3 files") that opens to the steps themselves.
  const groupRow = (run: () => ToolPart[], index: number) => {
    const id = () => `group:${run()[0]?.id}`
    const open = () => !!body.expanded[id()]
    const kind = () => stepOf(run()[0]).kind
    const diffs = createMemo(() => run().flatMap(editDiffs))
    const targets = createMemo(() => run().flatMap((part) => stepOf(part).target ?? []))
    return (
      <div data-slot="turn-steps-item" data-new={fresh()} style={{ "--i": index }} class="flex min-w-0 flex-col">
        <button
          type="button"
          data-slot="turn-steps-row"
          tabIndex={shown() ? 0 : -1}
          aria-expanded={open()}
          class="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-[12px] bg-v2-background-bg-layer-02 px-2.5 py-1.5 text-left text-[13px] leading-5 text-v2-text-text-base transition-colors hover:bg-v2-background-bg-layer-03 focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
          onClick={(event) => toggle(id(), event.currentTarget)}
        >
          <StepIcon name={stepIcon(kind())} size="small" class="shrink-0 text-v2-text-text-muted" />
          <span class="shrink-0 [font-weight:500]" classList={{ "text-v2-text-text-critical": run().some(isFailed) }}>
            {stepCountPhrase(language, kind(), run().length)}
          </span>
          <span
            class="min-w-0 truncate text-v2-text-text-muted"
            classList={{ "font-mono text-[12px]": codeTarget(kind()) }}
            title={targets().some((target) => fullTitle(target)) ? targets().join("\n") : undefined}
          >
            {targets().map(shortTarget).join(", ")}
          </span>
          <span class="flex-1" />
          <Show when={run().some(isRunning)}>
            <LoaderV2 width={12} height={12} class="shrink-0 text-v2-icon-icon-accent" />
          </Show>
          <Show when={diffs().length > 0}>
            <DiffChanges changes={diffs()} class="shrink-0 text-[12px]" />
          </Show>
          <Icon
            name="chevron-right"
            size="small"
            class="shrink-0 text-v2-text-text-muted transition-transform motion-reduce:transition-none"
            classList={{ "rotate-90 rtl:-rotate-90": open() }}
          />
        </button>
        <Show when={body.seen[id()]}>
          <div data-slot="turn-steps-reveal" data-open={open() ? "" : undefined}>
            <div>
              <div class="mt-1 flex flex-col gap-1 ps-4">
                <Index each={run()}>{(part, at) => stepRow(part(), at)}</Index>
              </div>
            </div>
          </div>
        </Show>
      </div>
    )
  }
  // Consecutive reads, searches, edits, commands or fetches merge into one row; reasoning and agents stand alone.
  const runs = createMemo(() =>
    props.parts.reduce<Part[][]>((list, part) => {
      const last = list.at(-1)
      const kind = part.type === "tool" && props.layout !== "rows" ? stepOf(part).kind : undefined
      if (kind && GROUPED.has(kind) && last?.[0]?.type === "tool" && stepOf(last[0]).kind === kind) last.push(part)
      else list.push([part])
      return list
    }, []),
  )

  return (
    <div
      data-slot="turn-steps"
      data-layout={props.layout ?? "grouped"}
      data-transcript={transcript() ? "" : undefined}
      class="flex w-full min-w-0 flex-col rounded-[16px] transition-colors motion-reduce:transition-none"
      classList={{
        "bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]": !transcript(),
      }}
    >
      <button
        type="button"
        data-component="turn-steps-summary"
        data-state={props.open ? "open" : "closed"}
        data-working={props.working ? "" : undefined}
        aria-expanded={props.open}
        class="flex h-9 w-full min-w-0 items-center gap-2 rounded-[16px] px-3 text-left text-[14px] leading-5 text-v2-text-text-base"
        onClick={(event) => {
          keepInPlace(event.currentTarget)
          props.onToggle(!props.open)
        }}
      >
        <Show
          when={props.working}
          fallback={<Icon name="check" size="small" class="shrink-0 text-v2-text-text-muted" />}
        >
          <LoaderV2 width={14} height={14} class="text-v2-icon-icon-accent" />
        </Show>
        <span data-slot="turn-steps-title" class="shrink-0 [font-weight:500] tabular-nums">
          <TextShimmer text={title()} active={props.working} />
        </span>
        <span data-slot="turn-steps-counts" class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <For each={counts()}>
            {(item) => (
              <TooltipV2 placement="top" class="shrink-0" value={stepCountPhrase(language, item.kind, item.count)}>
                <span
                  data-slot="turn-steps-count"
                  class="flex h-5 shrink-0 items-center gap-1 rounded-full bg-v2-background-bg-base px-2 text-[12px] tabular-nums text-v2-text-text-muted"
                >
                  <StepIcon name={stepIcon(item.kind)} size="small" aria-hidden="true" />
                  <span aria-hidden="true">{item.count.toLocaleString(language.intl())}</span>
                  <span class="sr-only">{stepCountPhrase(language, item.kind, item.count)}</span>
                </span>
              </TooltipV2>
            )}
          </For>
        </span>
        <Show when={summary().failed > 0}>
          <span data-slot="turn-steps-failed" class="shrink-0 text-[13px] text-v2-text-text-critical">
            {language.plural("secondBrain.turnSteps.failed", summary().failed, {
              count: summary().failed.toLocaleString(language.intl()),
            })}
          </span>
        </Show>
        <Show when={summary().declined > 0}>
          <span data-slot="turn-steps-declined" class="shrink-0 text-[13px] text-v2-text-text-muted">
            {language.plural("secondBrain.turnSteps.declined", summary().declined, {
              count: summary().declined.toLocaleString(language.intl()),
            })}
          </span>
        </Show>
        <Icon
          name="chevron-right"
          size="small"
          class="shrink-0 text-v2-text-text-muted transition-transform motion-reduce:transition-none"
          classList={{ "rotate-90 rtl:-rotate-90": props.open }}
        />
      </button>
      {/* Shown and hidden at once: the card sits in a virtualized timeline row. */}
      <Show when={ticker() || lanes().length > 0}>
        <div class="flex flex-col gap-2 px-3 pb-2.5 text-[13px] leading-5">
          {/* One line, fixed height: a new step replaces the old one instead of pushing rows below it. */}
          <Show when={ticker()} keyed>
            {(item) => (
              <div data-slot="turn-steps-ticker" aria-live="polite" class="h-5 overflow-hidden">
                <Show
                  when={item.part.type === "tool" ? item.part : undefined}
                  fallback={
                    <Show when={item.part.type === "reasoning" ? item.part : undefined}>
                      {(part) => (
                        <div
                          data-slot="turn-steps-ticker-step"
                          data-running={isThinking(part()) ? "" : undefined}
                          class="flex min-w-0 items-center gap-2 text-v2-text-text-base"
                        >
                          <StepIcon name="brain" size="small" class="shrink-0 text-v2-text-text-muted" />
                          <span class="shrink-0 [font-weight:500]">
                            <TextShimmer
                              text={language.t(
                                isThinking(part()) ? "secondBrain.turnSteps.thinking" : "secondBrain.turnSteps.thought",
                              )}
                              active={isThinking(part())}
                            />
                          </span>
                          <Show when={item.topic}>
                            {(topic) => <span class="min-w-0 truncate text-v2-text-text-muted">{topic()}</span>}
                          </Show>
                          <span class="flex-1" />
                          <Show when={isThinking(part()) && elapsed(part().time?.start)}>
                            {(time) => (
                              <span class="shrink-0 tabular-nums text-v2-text-text-muted" aria-hidden="true">
                                {time()}
                              </span>
                            )}
                          </Show>
                        </div>
                      )}
                    </Show>
                  }
                >
                  {(part) => (
                    <div
                      data-slot="turn-steps-ticker-step"
                      data-running={isRunning(part()) ? "" : undefined}
                      class="flex min-w-0 items-center gap-2 text-v2-text-text-base"
                    >
                      <StepIcon
                        name={stepIcon(stepOf(part()).kind)}
                        size="small"
                        class="shrink-0 text-v2-text-text-muted"
                      />
                      <span class="shrink-0 [font-weight:500]">
                        <TextShimmer text={label(part())} active={isRunning(part())} />
                      </span>
                      <Show when={stepOf(part()).target}>
                        {(target) => (
                          <span
                            class="min-w-0 truncate text-v2-text-text-muted"
                            classList={{ "font-mono text-[12px]": codeTarget(stepOf(part()).kind) }}
                            title={fullTitle(target())}
                          >
                            {shortTarget(target())}
                          </span>
                        )}
                      </Show>
                      <span class="flex-1" />
                      <Show when={isRunning(part()) && elapsed(startOf(part()))}>
                        {(time) => (
                          <span class="shrink-0 tabular-nums text-v2-text-text-muted" aria-hidden="true">
                            {time()}
                          </span>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>
              </div>
            )}
          </Show>
          <Show when={lanes().length > 0 && props.onOpenSubagent}>
            {(open) => (
              <div data-slot="turn-steps-lanes-header" class="flex h-5 min-w-0 items-center gap-2 text-[12px]">
                <span class="min-w-0 truncate text-v2-text-text-muted">
                  {language.t("secondBrain.sessionTab.subagents")}
                </span>
                <span class="flex-1" />
                <button
                  type="button"
                  data-action="turn-steps-open-agents"
                  aria-label={language.t("secondBrain.agents.openList")}
                  class="flex shrink-0 items-center gap-0.5 rounded-[6px] px-1 text-v2-text-text-accent transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
                  onClick={() => open()()}
                >
                  {language.t("secondBrain.agents.title")}
                  <Icon name="chevron-right" size="small" />
                </button>
              </div>
            )}
          </Show>
          <Index each={lanes()}>
            {(lane) => (
              <SubagentLane
                lane={lane()}
                now={now()}
                formatDuration={(ms) => formatTurnDuration(language, ms)}
                tokens={laneTokens(lane().part, childSession(lane().part))}
                onOpen={props.onOpenSubagent ? () => props.onOpenSubagent?.(lane().part) : undefined}
              />
            )}
          </Index>
        </div>
      </Show>
      {/* Open: every step on the card's own surface. Tools are filled rows that open to their output; reasoning is a
          one-line note that opens to its full text. */}
      <div
        ref={bodyEl}
        data-slot="turn-steps-body"
        data-open={shown() ? "" : undefined}
        data-animate={body.animate ? "" : undefined}
        aria-hidden={!shown()}
      >
        <div>
          <Show when={body.mounted}>
            <div data-slot="turn-steps-rows" class="flex flex-col gap-1 px-2 pb-2">
              <Index each={runs()}>
                {(run, index) => (
                  // Built untracked: Show reads these on every runs() update, and reading run() there would rebuild
                  // every row each time a step arrives. A row only rebuilds when it turns into a group.
                  <Show when={run().length > 1} fallback={untrack(() => stepRow(run()[0], index))}>
                    {untrack(() => groupRow(() => run() as ToolPart[], index))}
                  </Show>
                )}
              </Index>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
