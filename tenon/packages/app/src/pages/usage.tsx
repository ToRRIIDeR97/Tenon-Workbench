import { useNavigate } from "@solidjs/router"
import { Harness } from "@tenon/schema/harness"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js"
import { HarnessIcon } from "@/components/harness-icon"
import { PageEmpty, PageFrame, PageHeader, pageWideColumnClass } from "@/components/page"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { readUsage, type UsageSummary, type UsageThread } from "@/features/second-brain/client"
import {
  bucketDays,
  composition,
  dayDate,
  fillDays,
  folderName,
  formatCost,
  formatTokens,
  rangeSince,
  totalTokens,
  USAGE_RANGES,
  type DayBar,
  type TokenKind,
  type UsageRange,
} from "@/features/usage/usage-model"
import { settled } from "@/utils/resource"
import { sessionHref } from "@/utils/session-route"

const MAX_BARS = 45

const KIND_FILL: Record<TokenKind, string> = {
  input: "var(--v2-background-bg-accent)",
  output: "color-mix(in srgb, var(--v2-background-bg-accent) 62%, var(--v2-background-bg-base))",
  reasoning: "color-mix(in srgb, var(--v2-background-bg-accent) 34%, var(--v2-background-bg-base))",
  cacheWrite: "var(--v2-background-bg-layer-04)",
  cacheRead: "var(--v2-background-bg-layer-03)",
}

const HARNESS_NAMES: Record<string, string> = {
  [Harness.OpenCodeAcp]: "OpenCode",
  [Harness.ClaudeCode]: "Claude Code",
  [Harness.Codex]: "Codex",
  "command-code": "Command Code",
  gemini: "Gemini CLI",
}

const grow = "transition-transform duration-long ease-emphasized-decelerate motion-reduce:transition-none"

let lastSummary: { key: string; summary: UsageSummary } | undefined

export default function UsagePage() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const navigate = useNavigate()
  const [range, setRange] = createSignal<UsageRange>("month")
  const [revealed, setRevealed] = createSignal(false)
  const [hovered, setHovered] = createSignal<number>()
  const [open, setOpen] = createSignal<string>()
  const locale = () => language.intl()

  const request = createMemo(() => {
    const now = Date.now()
    return { range: range(), now, since: rangeSince(range(), now) }
  })
  const [usage, { refetch }] = createResource(request, (input) =>
    readUsage(
      {
        server: serverSDK().server,
        fetch: platform.fetch,
        target: { directory: layout.home.workspace() ?? undefined },
      },
      { since: input.since, offset: new Date().getTimezoneOffset() },
    ).then((summary) => {
      lastSummary = { key: `${server.key}\0${input.range}`, summary }
      return summary
    }),
  )
  const summary = () =>
    settled(usage) ?? (lastSummary?.key === `${server.key}\0${range()}` ? lastSummary.summary : undefined)
  const total = () => {
    const value = summary()
    return value ? totalTokens(value.totals) : 0
  }
  const bars = createMemo(() => {
    const value = summary()
    if (!value) return []
    return bucketDays(fillDays(value.days, request().since, request().now), MAX_BARS)
  })
  const maxBar = () => Math.max(1, ...bars().map((bar) => bar.total))
  const maxHarness = () => Math.max(1, ...(summary()?.harnesses.map((item) => item.total) ?? []))

  onMount(() => requestAnimationFrame(() => requestAnimationFrame(() => setRevealed(true))))

  const harnessName = (id: string) =>
    id === Harness.OpenCode ? language.t("harness.settings.defaults.builtIn") : (HARNESS_NAMES[id] ?? id)
  const tokens = (value: number) => formatTokens(value, locale())
  const dayLabel = (day: string) => dayDate(day).toLocaleDateString(locale(), { month: "short", day: "numeric" })
  const openThread = (id: string) => navigate(sessionHref(server.key, id))
  const kindLabel = (kind: TokenKind) => language.t(`secondBrain.usage.kind.${kind}`)
  const rangeLabel = (value: UsageRange) => language.t(`secondBrain.usage.range.${value}`)
  const axis = () => {
    const list = bars()
    const last = list.length - 1
    const picks = [...new Set([0, Math.round(last / 3), Math.round((last * 2) / 3), last])].filter(
      (index) => index >= 0,
    )
    return picks.map((index) => list[index])
  }

  return (
    <PageFrame labelledBy="usage-title">
      <PageHeader
        id="usage-title"
        column="wide"
        title={language.t("secondBrain.usage.title")}
        actions={
          <SegmentedControlV2
            aria-label={language.t("secondBrain.usage.range.label")}
            value={range()}
            onChange={(value) => {
              const next = USAGE_RANGES.find((item) => item === value)
              if (!next) return
              setOpen(undefined)
              setRange(next)
            }}
          >
            <For each={USAGE_RANGES}>
              {(value) => <SegmentedControlItemV2 value={value}>{rangeLabel(value)}</SegmentedControlItemV2>}
            </For>
          </SegmentedControlV2>
        }
      />
      <Show
        when={summary()}
        fallback={
          <Show when={usage.error} fallback={<PageEmpty loading title={language.t("secondBrain.usage.loading")} />}>
            <PageEmpty
              error
              title={language.t("secondBrain.usage.error.title")}
              action={
                <ButtonV2 variant="neutral" size="small" onClick={() => void refetch()}>
                  {language.t("secondBrain.usage.retry")}
                </ButtonV2>
              }
            >
              {language.t("secondBrain.usage.error.body")}
            </PageEmpty>
          </Show>
        }
      >
        {(value) => (
          <Show
            when={total() > 0}
            fallback={
              <Show
                when={range() !== "all"}
                fallback={
                  <PageEmpty title={language.t("secondBrain.usage.empty.title")}>
                    {language.t("secondBrain.usage.empty.body")}
                  </PageEmpty>
                }
              >
                <PageEmpty
                  title={language.t("secondBrain.usage.empty.rangeTitle", {
                    range: rangeLabel(range()).toLocaleLowerCase(locale()),
                  })}
                >
                  {language.t("secondBrain.usage.empty.rangeBody")}
                </PageEmpty>
              </Show>
            }
          >
            <div class={pageWideColumnClass} data-component="usage-page" aria-busy={usage.loading}>
              <section class="flex flex-col gap-3" aria-label={language.t("secondBrain.usage.composition")}>
                <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
                  <p class="flex items-baseline gap-2.5">
                    <span data-slot="usage-total" class="type-display text-v2-text-text-base tabular-nums">
                      {tokens(total())}
                    </span>
                    <span class="type-body text-v2-text-text-muted">
                      {language.t(`secondBrain.usage.summary.${range()}`)}
                    </span>
                  </p>
                  <div class="text-right type-meta">
                    <p class="text-v2-text-text-base tabular-nums">
                      {language.t("secondBrain.usage.cost", { cost: formatCost(value().cost, locale()) })}
                    </p>
                    <p class="text-v2-text-text-muted">{language.t("secondBrain.usage.costNote")}</p>
                  </div>
                </div>
                <div class="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                  <For each={composition(value().totals).filter((part) => part.share > 0)}>
                    {(part, index) => (
                      <span
                        class={`block h-full shrink-0 origin-left ${grow}`}
                        style={{
                          width: `max(3px, calc(${part.share * 100}% - 2px))`,
                          background: KIND_FILL[part.kind],
                          transform: revealed() ? "scaleX(1)" : "scaleX(0)",
                          "transition-delay": `${index() * 70 + 120}ms`,
                        }}
                      />
                    )}
                  </For>
                </div>
                <ul class="flex flex-wrap gap-x-5 gap-y-1.5 type-meta">
                  <For each={composition(value().totals)}>
                    {(part) => (
                      <li class="flex items-center gap-1.5">
                        <span class="size-2.5 shrink-0 rounded-[3px]" style={{ background: KIND_FILL[part.kind] }} />
                        <span class="text-v2-text-text-muted">{kindLabel(part.kind)}</span>
                        <span class="text-v2-text-text-base tabular-nums">{tokens(part.value)}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </section>

              <section class="flex flex-col gap-2.5" aria-labelledby="usage-by-day">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <h2 id="usage-by-day" class="flex-1 type-section text-v2-text-text-base">
                    {language.t("secondBrain.usage.byDay")}
                  </h2>
                  <span class="flex items-center gap-1.5 type-meta text-v2-text-text-muted">
                    <span class="size-2.5 rounded-[3px]" style={{ background: KIND_FILL.input }} />
                    {language.t("secondBrain.usage.day.fresh")}
                  </span>
                  <span class="flex items-center gap-1.5 type-meta text-v2-text-text-muted">
                    <span class="size-2.5 rounded-[3px]" style={{ background: KIND_FILL.cacheRead }} />
                    {language.t("secondBrain.usage.day.cached")}
                  </span>
                </div>
                <div class="relative" onMouseLeave={() => setHovered(undefined)}>
                  <div class="pointer-events-none absolute inset-0" aria-hidden="true">
                    <For each={[1 / 3, 2 / 3, 1]}>
                      {(line) => (
                        <span
                          class="absolute inset-x-0 h-px bg-v2-border-border-muted"
                          style={{ bottom: `${line * 100}%` }}
                        />
                      )}
                    </For>
                  </div>
                  <ol class="relative flex h-32 items-end gap-1" aria-label={language.t("secondBrain.usage.byDay")}>
                    <For each={bars()}>
                      {(bar, index) => (
                        <DayColumn
                          bar={bar}
                          index={index()}
                          max={maxBar()}
                          revealed={revealed()}
                          dimmed={hovered() !== undefined && hovered() !== index()}
                          label={`${dayLabel(bar.day)}: ${tokens(bar.total)}`}
                          onHover={() => setHovered(index())}
                        />
                      )}
                    </For>
                  </ol>
                  <Show when={hovered() !== undefined && bars()[hovered()!]}>
                    {(bar) => (
                      <div
                        role="tooltip"
                        class="pointer-events-none absolute top-0 z-10 w-52 rounded-[14px] bg-v2-background-bg-floating p-3 shadow-[var(--v2-elevation-floating)]"
                        style={{
                          left: `clamp(0px, calc(${((hovered()! + 0.5) / bars().length) * 100}% - 104px), calc(100% - 208px))`,
                        }}
                      >
                        <p class="mb-1.5 type-section text-v2-text-text-base">{dayLabel(bar().day)}</p>
                        <TipRow label={language.t("secondBrain.usage.day.total")} value={tokens(bar().total)} />
                        <TipRow label={language.t("secondBrain.usage.day.fresh")} value={tokens(bar().fresh)} />
                        <TipRow label={language.t("secondBrain.usage.day.cached")} value={tokens(bar().cached)} />
                      </div>
                    )}
                  </Show>
                </div>
                <div class="flex justify-between type-meta text-v2-text-text-faint" aria-hidden="true">
                  <For each={axis()}>{(bar) => <span>{dayLabel(bar.day)}</span>}</For>
                </div>
              </section>

              <div class="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
                <section class="flex min-w-0 flex-col gap-1.5" aria-labelledby="usage-by-harness">
                  <h2 id="usage-by-harness" class="type-section text-v2-text-text-base">
                    {language.t("secondBrain.usage.byHarness")}
                  </h2>
                  <div class="overflow-x-auto">
                    <table class="w-full min-w-[400px] table-fixed border-collapse type-body-compact">
                      <thead>
                        <tr class="border-b border-v2-border-border-muted type-meta text-v2-text-text-muted">
                          <th class="px-2 py-1.5 text-left font-[inherit]">
                            {language.t("secondBrain.usage.column.harness")}
                          </th>
                          <th class="w-[12%] px-2 py-1.5" aria-hidden="true" />
                          <th class="w-[68px] px-2 py-1.5 text-right font-[inherit]">
                            {language.t("secondBrain.usage.column.tokens")}
                          </th>
                          <th class="w-[104px] px-2 py-1.5 text-right font-[inherit]">
                            {language.t("secondBrain.usage.column.subagents")}
                          </th>
                          <th class="w-[72px] px-2 py-1.5 text-right font-[inherit]">
                            {language.t("secondBrain.usage.column.cost")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={value().harnesses}>
                          {(item) => (
                            <tr class="border-b border-v2-border-border-muted">
                              <td class="px-2 py-2.5">
                                <div class="flex min-w-0 items-center gap-2">
                                  <HarnessIcon
                                    instance={{ id: item.harness, name: harnessName(item.harness) }}
                                    class="size-4 shrink-0"
                                  />
                                  <div class="min-w-0">
                                    <p class="truncate type-row-title text-v2-text-text-base">
                                      {harnessName(item.harness)}
                                    </p>
                                    <Show when={item.models.length > 0}>
                                      <p
                                        class="truncate type-meta text-v2-text-text-muted"
                                        title={item.models.join(", ")}
                                      >
                                        {item.models.join(", ")}
                                      </p>
                                    </Show>
                                  </div>
                                </div>
                              </td>
                              <td class="px-2 py-2.5" aria-hidden="true">
                                <span class="block h-1 overflow-hidden rounded-full bg-v2-background-bg-layer-03">
                                  <span
                                    class={`block h-full origin-left rounded-full bg-v2-background-bg-accent ${grow}`}
                                    style={{ transform: `scaleX(${revealed() ? item.total / maxHarness() : 0})` }}
                                  />
                                </span>
                              </td>
                              <td class="px-2 py-2.5 text-right tabular-nums text-v2-text-text-base">
                                {tokens(item.total)}
                              </td>
                              <td class="px-2 py-2.5 text-right whitespace-nowrap tabular-nums">
                                <Show
                                  when={item.subagents > 0}
                                  fallback={
                                    <span class="text-v2-text-text-faint">
                                      {item.unreported > 0 ? language.t("secondBrain.usage.notReported") : "–"}
                                    </span>
                                  }
                                >
                                  <span class="text-v2-text-text-muted">{tokens(item.subagents)}</span>
                                  <Show when={item.unreported > 0}>
                                    <span class="block type-meta text-v2-text-text-faint">
                                      {language.plural("secondBrain.usage.notReportedCount", item.unreported, {
                                        count: item.unreported,
                                      })}
                                    </span>
                                  </Show>
                                </Show>
                              </td>
                              <td class="px-2 py-2.5 text-right tabular-nums text-v2-text-text-base">
                                {formatCost(item.cost, locale())}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section class="flex min-w-0 flex-col gap-1.5" aria-labelledby="usage-heaviest">
                  <div class="flex items-center gap-2">
                    <h2 id="usage-heaviest" class="flex-1 type-section text-v2-text-text-base">
                      {language.t("secondBrain.usage.heaviest")}
                    </h2>
                    <span class="type-meta text-v2-text-text-muted">
                      {language.plural("secondBrain.usage.threadCount", value().threads, { count: value().threads })}
                      {" · "}
                      {language.t("secondBrain.usage.heaviestNote")}
                    </span>
                  </div>
                  <ul class="flex flex-col">
                    <For each={value().heaviest}>
                      {(thread) => (
                        <ThreadRow
                          thread={thread}
                          open={open() === thread.id}
                          onToggle={() => setOpen(open() === thread.id ? undefined : thread.id)}
                          onOpen={openThread}
                          harnessName={harnessName}
                          tokens={tokens}
                        />
                      )}
                    </For>
                  </ul>
                </section>
              </div>
            </div>
          </Show>
        )}
      </Show>
    </PageFrame>
  )
}

function TipRow(props: { label: string; value: string }) {
  return (
    <p class="flex justify-between gap-2 type-meta">
      <span class="text-v2-text-text-muted">{props.label}</span>
      <span class="text-v2-text-text-base tabular-nums">{props.value}</span>
    </p>
  )
}

function DayColumn(props: {
  bar: DayBar
  index: number
  max: number
  revealed: boolean
  dimmed: boolean
  label: string
  onHover: () => void
}) {
  const style = (value: number) => ({
    height: `${(value / props.max) * 100}%`,
    transform: props.revealed ? "scaleY(1)" : "scaleY(0)",
    "transition-delay": `${props.index * 14 + 180}ms`,
  })
  return (
    <li
      class="flex h-full min-w-0 flex-1 flex-col justify-end transition-opacity duration-short ease-standard motion-reduce:transition-none"
      classList={{ "opacity-45": props.dimmed }}
      aria-label={props.label}
      onMouseEnter={() => props.onHover()}
    >
      <span
        class={`block w-full origin-bottom rounded-t-[4px] ${grow}`}
        style={{ ...style(props.bar.cached), background: KIND_FILL.cacheRead }}
      />
      <span
        class={`block w-full origin-bottom rounded-b-[2px] ${grow}`}
        classList={{ "rounded-t-[4px]": props.bar.cached === 0 }}
        style={{ ...style(props.bar.fresh), background: KIND_FILL.input }}
      />
    </li>
  )
}

function ThreadRow(props: {
  thread: UsageThread
  open: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  harnessName: (id: string) => string
  tokens: (value: number) => string
}) {
  const language = useLanguage()
  const title = () => props.thread.title || language.t("secondBrain.usage.untitled")
  const expandable = () => props.thread.subagentCount > 0 || props.thread.unreported > 0
  const meta = () =>
    [folderName(props.thread.directory), props.harnessName(props.thread.harness), props.thread.model]
      .filter(Boolean)
      .join(" · ")
  return (
    <li class="flex flex-col">
      <div class="-mx-2.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2.5 py-2 transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none">
        <button
          type="button"
          class="min-w-0 rounded-[6px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
          title={language.t("secondBrain.usage.openThread")}
          onClick={() => props.onOpen(props.thread.id)}
        >
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate type-row-title text-v2-text-text-base">{title()}</span>
            <Show when={props.thread.subagentCount > 0}>
              <span class="shrink-0 rounded-full bg-v2-background-bg-layer-02 px-2 py-0.5 type-meta text-v2-text-text-muted">
                {language.plural("secondBrain.usage.subagentCount", props.thread.subagentCount, {
                  count: props.thread.subagentCount,
                })}
              </span>
            </Show>
          </span>
          <span class="block truncate type-meta text-v2-text-text-muted">{meta()}</span>
        </button>
        <div class="flex items-center gap-1">
          <span class="type-row-title text-v2-text-text-base tabular-nums">{props.tokens(props.thread.total)}</span>
          <Show when={expandable()}>
            <button
              type="button"
              class="grid size-7 place-items-center rounded-full text-v2-icon-icon-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
              aria-expanded={props.open}
              aria-label={language.t("secondBrain.usage.showSubagents", { title: title() })}
              onClick={() => props.onToggle()}
            >
              <Icon
                name="chevron-down"
                size="small"
                class={`transition-transform duration-medium ease-emphasized-decelerate motion-reduce:transition-none ${props.open ? "rotate-180" : ""}`}
              />
            </button>
          </Show>
        </div>
      </div>
      <div
        class="grid transition-[grid-template-rows] duration-medium ease-emphasized-decelerate motion-reduce:transition-none"
        style={{ "grid-template-rows": props.open ? "1fr" : "0fr" }}
        inert={!props.open}
      >
        <div class="overflow-hidden">
          <ul class="flex flex-col gap-0.5 pt-0.5 pb-2 pl-3">
            <SubRow label={language.t("secondBrain.usage.mainThread")} value={props.tokens(props.thread.main)} />
            <For each={props.thread.subagents}>
              {(item) => (
                <SubRow
                  branch
                  label={item.name}
                  detail={item.description}
                  source={
                    item.source === "thread"
                      ? language.t("secondBrain.usage.source.thread")
                      : item.source === "opencode-session"
                        ? language.t("secondBrain.usage.source.opencodeSession")
                        : item.source === "claude-transcript"
                          ? language.t("secondBrain.usage.source.claudeTranscript")
                          : language.t("secondBrain.usage.source.harness", {
                              harness: props.harnessName(props.thread.harness),
                            })
                  }
                  value={
                    item.total === undefined ? language.t("secondBrain.usage.notReported") : props.tokens(item.total)
                  }
                  onOpen={item.sessionID ? () => props.onOpen(item.sessionID!) : undefined}
                />
              )}
            </For>
            <Show when={props.thread.subagentCount > props.thread.subagents.length}>
              <li class="py-1 pl-6 type-meta text-v2-text-text-faint">
                {language.plural(
                  "secondBrain.usage.moreSubagents",
                  props.thread.subagentCount - props.thread.subagents.length,
                  { count: props.thread.subagentCount - props.thread.subagents.length },
                )}
              </li>
            </Show>
            <Show when={props.thread.unreported > 0}>
              <li class="py-1 pl-6 type-meta text-v2-text-text-faint">
                {language.plural("secondBrain.usage.unreportedSubagents", props.thread.unreported, {
                  count: props.thread.unreported,
                })}
              </li>
            </Show>
          </ul>
        </div>
      </div>
    </li>
  )
}

function SubRow(props: {
  label: string
  value: string
  detail?: string
  source?: string
  branch?: boolean
  onOpen?: () => void
}) {
  return (
    <li class="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 py-1 pr-2.5">
      <span
        class="h-5 w-3 -translate-y-2 rounded-bl-[6px]"
        classList={{ "border-b border-l border-v2-border-border-strong": !!props.branch }}
        aria-hidden="true"
      />
      <div class="min-w-0">
        <p class="truncate type-meta">
          <Show
            when={props.onOpen}
            fallback={<span class="text-v2-text-text-base [font-weight:600]">{props.label}</span>}
          >
            <button
              type="button"
              class="rounded-[4px] text-v2-text-text-base [font-weight:600] hover:underline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
              onClick={() => props.onOpen?.()}
            >
              {props.label}
            </button>
          </Show>
          <Show when={props.detail}>
            <span class="text-v2-text-text-muted"> {props.detail}</span>
          </Show>
        </p>
        <Show when={props.source}>
          <p class="truncate type-meta text-v2-text-text-faint">{props.source}</p>
        </Show>
      </div>
      <span class="type-meta text-v2-text-text-base tabular-nums">{props.value}</span>
    </li>
  )
}
