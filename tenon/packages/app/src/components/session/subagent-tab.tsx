import { For, Match, Show, Switch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { AssistantMessage, ToolPart } from "@opencode-ai/sdk/v2/client"
import { Harness } from "@tenon/schema/harness"
import { subagentName } from "@tenon/session-ui/step-kind"
import { Markdown } from "@tenon/session-ui/markdown"
import { useData } from "@tenon/session-ui/context"
import { ScrollView } from "@tenon/ui/scroll-view"
import { Icon } from "@tenon/ui/v2/icon"
import { LoaderV2 } from "@tenon/ui/v2/loader-v2"
import { ViewSwitch } from "@tenon/ui/v2/view-switch"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { getRelativeTime } from "@/utils/time"
import { createSessionContextFormatter } from "./session-context-format"
import { subagentDetail, type SubagentTranscriptEntry } from "./subagent-detail"
import { SubagentLane, childLaneSteps, laneTokens, subagentLane, subagentRunning, taskSessionID } from "./subagent-lane"
import {
  childTranscript,
  findSubagent,
  matchesFilter,
  splitResult,
  subagentCounts,
  taskResult,
  threadSubagents,
  type SubagentFilter,
  type SubagentGroup,
  type ThreadSubagent,
} from "./subagent-list"
import { formatTurnDuration } from "./turn-steps-summary"

/**
 * Every subagent in the open thread, grouped by turn, newest first. One lookup serves the tab's label and body; it
 * scans the thread only while `enabled` (the tab is open), so streaming elsewhere doesn't pay for it.
 */
export function useThreadSubagents(enabled: () => boolean) {
  const sync = useSync()
  const { params } = useSessionLayout()
  return createMemo(() => {
    const sessionID = params.id
    if (!sessionID || !enabled()) return [] as SubagentGroup[]
    return threadSubagents(sync().data.message[sessionID] ?? [], (id) => sync().data.part[id])
  })
}

/** Agents tab trigger content: "Agents" and a badge with how many are running. */
export function AgentsTabLabel(props: { groups: SubagentGroup[] }) {
  const language = useLanguage()
  const running = createMemo(() => subagentCounts(props.groups).running)
  return (
    <>
      <span>{language.t("secondBrain.agents.title")}</span>
      <Show when={running() > 0}>
        <span
          data-slot="agents-tab-badge"
          aria-label={language.t("secondBrain.agents.runningBadge", { count: running() })}
          class="flex h-4 min-w-4 items-center justify-center rounded-full bg-v2-background-bg-accent-container px-1 text-[11px] leading-4 tabular-nums text-v2-text-text-on-accent-container"
        >
          {running().toLocaleString(language.intl())}
        </span>
      </Show>
    </>
  )
}

/** The Agents tab: every subagent in the thread as lanes, or one agent's detail when `selected` names it. */
export function AgentsTab(props: {
  groups: SubagentGroup[]
  selected?: string
  onSelect: (partID: string | undefined) => void
  /** Display name of a harness instance from the harness list; undefined when it isn't known. */
  harnessName?: (id: string) => string | undefined
}) {
  const selected = createMemo(() => findSubagent(props.groups, props.selected))
  return (
    <ViewSwitch class="h-full" key={props.selected ?? "list"}>
      <Show when={props.selected} fallback={<AgentsList groups={props.groups} onSelect={(id) => props.onSelect(id)} />}>
        <Show when={selected()} keyed fallback={<Missing onBack={() => props.onSelect(undefined)} />}>
          {(item) => (
            <AgentDetail item={item} onBack={() => props.onSelect(undefined)} harnessName={props.harnessName} />
          )}
        </Show>
      </Show>
    </ViewSwitch>
  )
}

/** One clock for elapsed times; it only ticks while something runs. */
function useNow(active: () => boolean) {
  const [clock, setClock] = createStore({ now: Date.now() })
  createEffect(() => {
    if (!active()) return
    setClock("now", Date.now())
    const timer = setInterval(() => setClock("now", Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  return () => clock.now
}

function AgentsList(props: { groups: SubagentGroup[]; onSelect: (partID: string) => void }) {
  const language = useLanguage()
  const sync = useSync()
  const [state, setState] = createStore<{ filter: SubagentFilter }>({ filter: "all" })
  const counts = createMemo(() => subagentCounts(props.groups))
  const now = useNow(() => counts().running > 0)
  const groups = createMemo(() =>
    props.groups.flatMap((group) => {
      const items = group.items.filter((item) => matchesFilter(item.part, state.filter))
      return items.length > 0 ? [{ ...group, items }] : []
    }),
  )
  const childSteps = (part: ToolPart) => {
    const id = taskSessionID(part)
    if (!id) return undefined
    return childLaneSteps((sync().data.message[id] ?? []).flatMap((message) => sync().data.part[message.id] ?? []))
  }
  const childSession = (part: ToolPart) => {
    const id = taskSessionID(part)
    return id ? sync().session.get(id) : undefined
  }
  const filters: SubagentFilter[] = ["all", "running", "failed"]
  const time = (createdAt: number | undefined) =>
    createdAt === undefined
      ? undefined
      : getRelativeTime(new Date(createdAt).toISOString(), (key, params) => language.t(key, params))

  return (
    <ScrollView class="@container h-full">
      <div data-slot="agents-tab-list" class="flex flex-col gap-4 px-4 pt-2 pb-10">
        <div role="radiogroup" class="flex flex-wrap gap-1.5">
          <For each={filters}>
            {(filter) => (
              <button
                type="button"
                role="radio"
                data-slot="agents-tab-filter"
                aria-checked={state.filter === filter}
                class="flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] leading-4 transition-colors duration-short ease-standard motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
                classList={{
                  "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container": state.filter === filter,
                  "bg-v2-background-bg-layer-01 text-v2-text-text-base hover:bg-v2-background-bg-layer-02":
                    state.filter !== filter,
                }}
                onClick={() => setState("filter", filter)}
              >
                <span>{language.t(`secondBrain.agents.filter.${filter}`)}</span>
                <span class="tabular-nums opacity-70">{counts()[filter].toLocaleString(language.intl())}</span>
              </button>
            )}
          </For>
        </div>
        <Show
          when={groups().length > 0}
          fallback={
            <div class="px-1 text-[13px] text-v2-text-text-muted">
              {language.t(counts().all === 0 ? "secondBrain.agents.empty" : "secondBrain.agents.emptyFilter")}
            </div>
          }
        >
          <For each={groups()}>
            {(group) => (
              <section data-slot="agents-tab-group" class="flex flex-col gap-2">
                <div class="flex min-w-0 items-center gap-1.5 px-1 text-[12px] leading-4 text-v2-text-text-muted">
                  <span class="shrink-0 [font-weight:500]">
                    {language.t("secondBrain.agents.turn", { number: group.turn.toLocaleString(language.intl()) })}
                  </span>
                  <Show when={time(group.createdAt)}>
                    {(value) => (
                      <>
                        <span aria-hidden="true">·</span>
                        <span class="min-w-0 truncate">{value()}</span>
                      </>
                    )}
                  </Show>
                </div>
                <div class="flex flex-col gap-1 rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2 text-[13px] leading-5 text-v2-text-text-base">
                  <For each={group.items}>
                    {(item) => (
                      <SubagentLane
                        lane={subagentLane(item.part, childSteps)}
                        now={now()}
                        formatDuration={(ms) => formatTurnDuration(language, ms)}
                        tokens={laneTokens(item.part, childSession(item.part))}
                        onOpen={() => props.onSelect(item.part.id)}
                      />
                    )}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </div>
    </ScrollView>
  )
}

function BackLink(props: { onBack: () => void }) {
  const language = useLanguage()
  return (
    <button
      type="button"
      data-action="agents-tab-back"
      class="-ms-1 flex items-center gap-0.5 self-start rounded-[6px] px-1 text-[12px] leading-5 text-v2-text-text-accent transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
      onClick={() => props.onBack()}
    >
      <Icon name="chevron-left" size="small" />
      {language.t("secondBrain.agents.back")}
    </button>
  )
}

function Missing(props: { onBack: () => void }) {
  const language = useLanguage()
  return (
    <div class="flex h-full flex-col gap-4 px-4 pt-2">
      <BackLink onBack={props.onBack} />
      <div class="text-[13px] leading-5 text-v2-text-text-muted">{language.t("secondBrain.agentTab.missing")}</div>
    </div>
  )
}

function AgentDetail(props: {
  item: ThreadSubagent
  onBack: () => void
  harnessName?: (id: string) => string | undefined
}) {
  const language = useLanguage()
  const sync = useSync()
  const data = useData()
  const part = () => props.item.part
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }))
  const named = createMemo(() => subagentName(part().state.input))
  const name = () => named().name ?? named().tag ?? language.t("secondBrain.agentTab.agentFallback")
  const prompt = () => {
    const value = part().state.input?.prompt
    return typeof value === "string" && value.trim() ? value : undefined
  }
  const childID = createMemo(() => taskSessionID(part()))
  // A `task` agent's steps live in its child session; load it once if the thread hasn't.
  createEffect(() => {
    const id = childID()
    if (!id || sync().data.message[id]) return
    void sync()
      .session.sync(id)
      .catch(() => {})
  })
  const childMessages = createMemo(() => {
    const id = childID()
    return id ? (sync().data.message[id] ?? []) : []
  })
  const acp = createMemo(() => (part().tool === "acp_subagent" ? subagentDetail(part()) : undefined))
  const finished = () => !subagentRunning(part())
  const split = createMemo(() =>
    splitResult(
      acp()?.transcript ?? childTranscript(childMessages(), (id) => sync().data.part[id]),
      part().state.status === "completed",
    ),
  )
  const result = createMemo(() => {
    const state = part().state
    if (state.status === "error") return undefined
    if (split().result) return split().result
    if (state.status !== "completed" || !state.output) return undefined
    return part().tool === "task" ? taskResult(state.output) : state.output.trim() || undefined
  })
  const error = () => (part().state.status === "error" ? (part().state as { error: string }).error : undefined)
  const child = createMemo(() => {
    const id = childID()
    return id ? sync().session.get(id) : undefined
  })
  const model = createMemo(() => {
    const last = childMessages().findLast((message): message is AssistantMessage => message.role === "assistant")
    return last?.modelID
  })
  const tokens = () => laneTokens(part(), child())
  const cost = () => {
    const value = acp() ? acp()!.usage.cost : child()?.cost
    return value !== undefined && value > 0 ? value : undefined
  }
  const harnessName = () => {
    const id = props.item.harness
    const listed = id ? props.harnessName?.(id) : undefined
    if (listed) return listed
    if (id === Harness.OpenCode || !id) return language.t("harness.tenonWorkbench")
    if (id === Harness.OpenCodeAcp) return language.t("harness.openCode")
    if (id === Harness.ClaudeCode) return language.t("harness.claudeCode")
    if (id === Harness.Codex) return language.t("harness.codex")
    return language.t("secondBrain.agentTab.thisHarness")
  }
  const openSession = () => {
    const id = childID()
    if (id) data.navigateToSession?.(id)
  }

  return (
    <ScrollView class="@container h-full">
      <div data-slot="agents-tab-detail" class="flex flex-col gap-4 px-4 pt-2 pb-10">
        <BackLink onBack={props.onBack} />
        <div data-slot="agent-tab-heading" class="flex min-w-0 flex-col gap-1">
          <div class="flex min-w-0 items-center gap-1.5">
            <Show when={!finished()}>
              <LoaderV2 width={12} height={12} style={{ color: "var(--v2-icon-icon-accent)" }} />
            </Show>
            <span class="min-w-0 truncate text-[15px] leading-5 text-v2-text-text-base [font-weight:600]">
              {name()}
            </span>
            <Show when={named().name && named().tag}>
              {(tag) => (
                <span class="shrink-0 rounded-full bg-v2-background-bg-layer-01 px-1.5 text-[11px] leading-4 text-v2-text-text-muted">
                  {tag()}
                </span>
              )}
            </Show>
          </div>
          <div
            class="text-[12px] leading-4"
            classList={{
              "text-v2-text-text-critical": !!error(),
              "text-v2-text-text-muted": !error(),
            }}
          >
            {statusText(language, part().state.status)}
          </div>
        </div>

        <Show when={prompt()}>
          {(value) => (
            <div class="flex flex-col gap-1 rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2.5">
              <div class="text-[11px] leading-4 text-v2-text-text-muted">
                {language.t("secondBrain.agentTab.prompt")}
              </div>
              <div class="max-h-60 overflow-auto whitespace-pre-wrap break-words text-[13px] text-v2-text-text-muted">
                {value()}
              </div>
            </div>
          )}
        </Show>

        <div data-slot="agent-tab-conversation" class="flex flex-col gap-2">
          <div class="text-[11px] leading-4 text-v2-text-text-muted">{language.t("secondBrain.agents.steps")}</div>
          <For each={split().steps}>{(entry) => <TranscriptEntry entry={entry} />}</For>
          <Show when={split().steps.length === 0}>
            <div class="text-[13px] text-v2-text-text-muted">{language.t("secondBrain.agentTab.empty")}</div>
          </Show>
          <Show when={acp()?.truncated}>
            <div class="text-[12px] text-v2-text-text-muted">{language.t("secondBrain.agentTab.truncated")}</div>
          </Show>
        </div>

        <Show when={error() ?? result()}>
          {(value) => (
            <div data-slot="agents-tab-result" class="flex flex-col gap-1">
              <div class="text-[11px] leading-4 text-v2-text-text-muted">{language.t("secondBrain.agents.result")}</div>
              <Show
                when={!error()}
                fallback={
                  <div class="whitespace-pre-wrap break-words rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2.5 text-[13px] text-v2-text-text-critical">
                    {value()}
                  </div>
                }
              >
                <div class="rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2.5 text-[13px] text-v2-text-text-base">
                  <Markdown text={value()} />
                </div>
              </Show>
            </div>
          )}
        </Show>

        <div
          data-slot="agents-tab-footer"
          class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-v2-border-border-muted pt-3 text-[12px] leading-4 text-v2-text-text-muted"
        >
          <Show when={model()}>
            {(value) => (
              <>
                <span class="min-w-0 truncate font-mono">{value()}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
          </Show>
          <span class="tabular-nums">
            {tokens() === undefined
              ? language.t("secondBrain.agentTab.notReported", { harness: harnessName() })
              : language.t("secondBrain.agents.tokens", { count: formatter().number(tokens()) })}
          </span>
          <Show when={cost()}>
            {(value) => (
              <>
                <span aria-hidden="true">·</span>
                <span class="tabular-nums">{usd().format(value())}</span>
              </>
            )}
          </Show>
          <Show when={childID() && data.navigateToSession}>
            <span class="flex-1" />
            <button
              type="button"
              data-action="agents-tab-open-session"
              class="flex items-center gap-0.5 rounded-[6px] px-1 text-v2-text-text-accent transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
              onClick={openSession}
            >
              {language.t("secondBrain.agents.openSession")}
              <Icon name="chevron-right" size="small" />
            </button>
          </Show>
        </div>
      </div>
    </ScrollView>
  )
}

function TranscriptEntry(props: { entry: SubagentTranscriptEntry }) {
  const language = useLanguage()
  return (
    <Switch>
      <Match when={props.entry.type === "text" && props.entry}>
        {(entry) => (
          <div class="text-[13px] text-v2-text-text-base">
            <Markdown text={(entry() as { text: string }).text} />
          </div>
        )}
      </Match>
      <Match when={props.entry.type === "reasoning" && props.entry}>
        {(entry) => (
          <details data-slot="subagent-details" class="group text-[13px] text-v2-text-text-muted">
            <summary class={SUMMARY}>
              <Disclosure />
              {language.t("secondBrain.agentTab.reasoning")}
            </summary>
            <div class="mt-1 whitespace-pre-wrap break-words">{(entry() as { text: string }).text}</div>
          </details>
        )}
      </Match>
      <Match when={props.entry.type === "tool" && props.entry}>
        {(entry) => {
          const tool = () => entry() as Extract<SubagentTranscriptEntry, { type: "tool" }>
          const row = () => (
            <>
              <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-v2-text-text-base">
                {tool().title ?? tool().tool}
              </span>
              <span class="shrink-0 text-[12px] text-v2-text-text-muted">{statusText(language, tool().status)}</span>
            </>
          )
          return (
            <div class="rounded-[12px] bg-v2-background-bg-layer-01 px-3 py-1.5">
              <Show
                when={tool().output}
                fallback={
                  <div class="flex min-w-0 items-center gap-2">
                    {/* Keeps titles aligned with expandable rows. */}
                    <span class="size-3 shrink-0" aria-hidden="true" />
                    {row()}
                  </div>
                }
              >
                {(output) => (
                  <details data-slot="subagent-details" class="group">
                    <summary class={SUMMARY}>
                      <Disclosure />
                      {row()}
                    </summary>
                    <pre class="mt-1.5 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[12px] text-v2-text-text-muted">
                      {output()}
                    </pre>
                  </details>
                )}
              </Show>
            </div>
          )
        }}
      </Match>
    </Switch>
  )
}

// The summary is the row itself, so the disclosure marker sits on the same line as its content.
const SUMMARY =
  "flex min-w-0 list-none items-center gap-2 select-none rounded-[6px] [&::-webkit-details-marker]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"

function Disclosure() {
  return (
    <Icon
      name="chevron-right"
      size="small"
      class="size-3 shrink-0 text-v2-icon-icon-muted transition-transform duration-short ease-standard group-open:rotate-90 rtl:group-open:-rotate-90 motion-reduce:transition-none"
    />
  )
}

/** Tool part statuses and ACP step statuses (`in_progress`, `failed`) share these labels. */
function statusText(language: ReturnType<typeof useLanguage>, status: string) {
  if (status === "pending") return language.t("secondBrain.agentTab.status.pending")
  if (status === "running" || status === "in_progress") return language.t("secondBrain.agentTab.status.running")
  if (status === "error" || status === "failed") return language.t("secondBrain.agentTab.status.error")
  return language.t("secondBrain.agentTab.status.completed")
}
