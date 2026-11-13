import { createMemo, createEffect, createSignal, on, onCleanup, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { checksum } from "@tenon/core/util/encode"
import { findLast } from "@tenon/core/util/array"
import { same } from "@/utils/same"
import { Icon } from "@tenon/ui/v2/icon"
import { AccordionV2 } from "@tenon/ui/v2/accordion-v2"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { SelectV2 } from "@tenon/ui/v2/select-v2"
import { File } from "@tenon/session-ui/file"
import { Markdown } from "@tenon/session-ui/markdown"
import { ScrollView } from "@tenon/ui/scroll-view"
import type { Message, Part, ToolPart, UserMessage } from "@opencode-ai/sdk/v2/client"
import { subagentName, summarizeTurn } from "@tenon/session-ui/step-kind"
import { useData } from "@tenon/session-ui/context"
import { Harness } from "@tenon/schema/harness"
import { showToast } from "@/utils/toast"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { getSessionContext, getSessionHarnesses } from "./session-context-metrics"
import { estimateSessionContextBreakdown, type SessionContextBreakdownKey } from "./session-context-breakdown"
import { createSessionContextFormatter } from "./session-context-format"
import { getSessionTotals, getSessionUsage, getSubagentUsage } from "./session-usage"
import { stepCountPhrases } from "./turn-steps-summary"
import { heaviestContextItems } from "./context-heaviest"
import { SubagentCards, type SubagentCardRow } from "./subagent-cards"
import { subagentContexts } from "./subagent-context"
import { threadSubagents } from "./subagent-list"
import { useCommand } from "@/context/command"
import { Reveal } from "@tenon/ui/v2/reveal"

// User and assistant turns share one "Messages" segment. The Environment window's shades (one step of the accent
// or grey per kind), so the parts differ in lightness as well as hue and both context bars read the same.
type BreakdownGroup = "system" | "messages" | "tool" | "other"
const BREAKDOWN_SHADE: Record<BreakdownGroup, string> = {
  messages: "bg-v2-icon-icon-accent",
  tool: "bg-v2-icon-icon-accent/55",
  system: "bg-v2-text-text-muted",
  other: "bg-v2-border-border-strong",
}
const breakdownGroup = (key: SessionContextBreakdownKey): BreakdownGroup =>
  key === "user" || key === "assistant" ? "messages" : key

function RawMessageContent(props: { message: Message; getParts: (id: string) => Part[]; onRendered: () => void }) {
  const file = createMemo(() => {
    const parts = props.getParts(props.message.id)
    const contents = JSON.stringify({ message: props.message, parts }, null, 2)
    return {
      name: `${props.message.role}-${props.message.id}.json`,
      contents,
      cacheKey: checksum(contents),
    }
  })

  return (
    <File
      mode="text"
      file={file()}
      overflow="wrap"
      class="select-text"
      onRendered={() => requestAnimationFrame(props.onRendered)}
    />
  )
}

function RawMessage(props: {
  message: Message
  getParts: (id: string) => Part[]
  onRendered: () => void
  time: (value: number | string | undefined) => string
}) {
  return (
    <AccordionV2.Item value={props.message.id}>
      <AccordionV2.Header>
        <AccordionV2.Trigger>
          <div class="flex w-full min-w-0 items-center justify-between gap-2">
            <div class="min-w-0 truncate [font-weight:500]">
              {props.message.role} <span class="text-v2-text-text-muted [font-weight:400]">• {props.message.id}</span>
            </div>
            <div class="shrink-0 text-[12px] text-v2-text-text-muted">{props.time(props.message.time.created)}</div>
          </div>
        </AccordionV2.Trigger>
      </AccordionV2.Header>
      <AccordionV2.Content>
        <div class="px-3 pb-3">
          <RawMessageContent message={props.message} getParts={props.getParts} onRendered={props.onRendered} />
        </div>
      </AccordionV2.Content>
    </AccordionV2.Item>
  )
}

const emptyMessages: Message[] = []
const emptyUserMessages: UserMessage[] = []

export function SessionContextTab() {
  const sync = useSync()
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useSDK()
  const providers = useProviders(() => sdk().directory)
  const { params, view } = useSessionLayout()

  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))

  const messages = createMemo(
    () => {
      const id = params.id
      if (!id) return emptyMessages
      return (sync().data.message[id] ?? []) as Message[]
    },
    emptyMessages,
    { equals: same },
  )

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )

  const visibleUserMessages = createMemo(
    () => {
      const revert = info()?.revert?.messageID
      if (!revert) return userMessages()
      const boundary = userMessages().findIndex((message) => message.id === revert)
      return boundary < 0 ? userMessages() : userMessages().slice(0, boundary)
    },
    emptyUserMessages,
    { equals: same },
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const getParts = (id: string) => (sync().data.part[id] ?? []) as Part[]
  const harnesses = createMemo(() => getSessionHarnesses(messages()))
  const [selectedHarness, setSelectedHarness] = createSignal<string>()
  createEffect(() => {
    const available = harnesses()
    if (available.includes(selectedHarness() ?? "")) return
    setSelectedHarness(available.at(-1))
  })
  const harnessLabel = (id: string) => {
    if (id === Harness.OpenCode) return language.t("harness.tenonWorkbench")
    if (id === Harness.OpenCodeAcp) return language.t("harness.openCode")
    if (id === Harness.ClaudeCode) return language.t("harness.claudeCode")
    if (id === Harness.Codex) return language.t("harness.codex")
    return id
  }
  const harnessOptions = createMemo(() => harnesses().map((id) => ({ id, label: harnessLabel(id) })))
  const ctx = createMemo(() =>
    getSessionContext(messages(), [...providers.all().values()], selectedHarness(), (id) => sync().data.part[id]),
  )
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))

  // The server's whole-session totals have no per-harness split, so one harness's rows sum the loaded messages.
  const perHarness = () => harnesses().length > 1
  const usage = createMemo(() =>
    perHarness() ? getSessionUsage(messages(), { harness: selectedHarness() }) : getSessionTotals(info(), messages()),
  )
  const subagentUsage = createMemo(() => getSubagentUsage(messages(), getParts, (id) => sync().session.get(id)))
  const harnessParts = createMemo(() =>
    messages()
      .filter(
        (message) =>
          message.role === "assistant" &&
          (!selectedHarness() ||
            ((message as Message & { harnessInstanceID?: string }).harnessInstanceID ?? Harness.OpenCode) ===
              selectedHarness()),
      )
      .flatMap((message) => getParts(message.id)),
  )
  const toolPhrases = createMemo(() => stepCountPhrases(language, summarizeTurn(harnessParts()).counts))
  // Built-in `task` and harness `acp_subagent` calls; each row opens the agent in the Agents tab.
  const data = useData()
  const subagents = createMemo(() =>
    harnessParts().flatMap((part) => {
      if (part.type !== "tool" || (part.tool !== "task" && part.tool !== "acp_subagent")) return []
      const tool = part as ToolPart
      const metadata = ("metadata" in tool.state ? tool.state.metadata : undefined) ?? {}
      const sessionID = typeof metadata.sessionId === "string" ? metadata.sessionId : undefined
      const named = subagentName(tool.state.input)
      return [
        {
          id: tool.id,
          sessionID: tool.sessionID,
          title:
            named.name ??
            (sessionID ? sync().session.get(sessionID)?.title : undefined) ??
            named.tag ??
            language.t("secondBrain.agentTab.agentFallback"),
          agent: named.name ? named.tag : undefined,
          status: tool.state.status,
        },
      ]
    }),
  )
  // Each subagent's own context, for the Subagents cards that take the place of "Taking the most room".
  const subagentCards = createMemo((): SubagentCardRow[] =>
    subagentContexts(threadSubagents(messages(), getParts), (id) => sync().session.get(id)).map((row) => {
      const named = subagentName(row.input)
      return {
        ...row,
        title:
          named.name ??
          (row.childID ? sync().session.get(row.childID)?.title : undefined) ??
          named.tag ??
          language.t("secondBrain.agentTab.agentFallback"),
        agent: named.name ? named.tag : undefined,
      }
    }),
  )
  const counts = createMemo(() => {
    const all = messages()
    const user = all.reduce((count, x) => count + (x.role === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, x) => count + (x.role === "assistant" ? 1 : 0), 0)
    return {
      all: all.length,
      user,
      assistant,
    }
  })

  const systemPrompt = createMemo(() => {
    const msg = findLast(visibleUserMessages(), (m) => !!m.system)
    const system = msg?.system
    if (!system) return
    const trimmed = system.trim()
    if (!trimmed) return
    return trimmed
  })

  const providerLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.providerLabel
  })

  const modelLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.modelLabel
  })

  const breakdown = createMemo(
    on(
      () => [ctx()?.message.id, ctx()?.input, messages().length, systemPrompt()],
      () => {
        const c = ctx()
        if (!c?.input) return []
        return estimateSessionContextBreakdown({
          messages: messages(),
          parts: sync().data.part as Record<string, Part[] | undefined>,
          input: c.input,
          systemPrompt: systemPrompt(),
        })
      },
    ),
  )

  const breakdownGroups = createMemo(() => {
    const groups = new Map<BreakdownGroup, { width: number; percent: number }>()
    for (const segment of breakdown()) {
      const key = breakdownGroup(segment.key)
      const current = groups.get(key) ?? { width: 0, percent: 0 }
      groups.set(key, { width: current.width + segment.width, percent: current.percent + segment.percent })
    }
    return [...groups].map(([key, value]) => ({ key, ...value }))
  })

  // The biggest things in the context, for "Taking the most room"; each opens its turn in the thread.
  const heaviest = createMemo(() =>
    heaviestContextItems({ messages: messages(), parts: sync().data.part as Record<string, Part[] | undefined> }),
  )
  const command = useCommand()
  const [usageOpen, setUsageOpen] = createSignal(false)
  // The session page reveals the turn (`revealMessage`); the tab lives in the side panel, beside it.
  const revealTurn = (turnID: string) =>
    window.dispatchEvent(new CustomEvent("tenon:reveal-message", { detail: turnID }))
  // A share of what's used, as a share of the whole window when the window is known.
  const windowShare = (share: number) => (ctx()?.limit ? (share * (ctx()?.usage ?? 100)) / 100 : share)
  const compactNumber = (value: number | undefined) =>
    value === undefined
      ? "—"
      : new Intl.NumberFormat(language.intl(), { notation: "compact", maximumFractionDigits: 1 }).format(value)

  const breakdownLabel = (key: BreakdownGroup) => {
    if (key === "system") return language.t("context.breakdown.system")
    if (key === "messages") return language.t("context.stats.messages")
    if (key === "tool") return language.t("context.breakdown.tool")
    return language.t("context.breakdown.other")
  }

  // What the subagents spent, apart from the context figure below. Declared before `details`, which the memo reads
  // on creation.
  const subagentSpend = () => {
    const spent = subagentUsage()
    if (!spent || spent.count === 0) return undefined
    const tokens = formatter().number(spent.total)
    if (spent.cost === undefined) return language.t("secondBrain.contextMenu.usedTokens", { count: tokens })
    return language.t("secondBrain.sessionTab.subagentUsage", { tokens, cost: usd().format(spent.cost) })
  }

  // Only what the harness reported; a missing value hides its row instead of reading "Not reported".
  const details = createMemo(() => {
    const c = ctx()
    const u = usage()
    const rows: { label: Parameters<typeof language.t>[0]; value: string | undefined }[] = [
      { label: "context.stats.model", value: c ? modelLabel() : undefined },
      { label: "context.stats.provider", value: c ? providerLabel() : undefined },
      {
        label: "secondBrain.sessionTab.contextWindow",
        value: c?.compacted
          ? language.t("secondBrain.contextMenu.compacted")
          : c?.limit
            ? language.t("secondBrain.sessionTab.contextUsed", {
                used: formatter().number(c.total),
                limit: formatter().number(c.limit),
              })
            : undefined,
      },
      { label: "secondBrain.sessionTab.input", value: u.input > 0 ? formatter().number(u.input) : undefined },
      { label: "secondBrain.sessionTab.output", value: u.output > 0 ? formatter().number(u.output) : undefined },
      {
        label: "context.stats.reasoningTokens",
        value: u.reasoning > 0 ? formatter().number(u.reasoning) : undefined,
      },
      {
        label: "secondBrain.sessionTab.cacheRead",
        value: u.cacheRead > 0 ? formatter().number(u.cacheRead) : undefined,
      },
      {
        label: "secondBrain.sessionTab.cacheWrite",
        value: u.cacheWrite > 0 ? formatter().number(u.cacheWrite) : undefined,
      },
      {
        label: "secondBrain.sessionTab.cacheHit",
        value:
          u.cacheHit === undefined
            ? undefined
            : u.cacheHit.toLocaleString(language.intl(), { style: "percent", maximumFractionDigits: 0 }),
      },
      { label: "secondBrain.sessionTab.cost", value: u.cost === undefined ? undefined : usd().format(u.cost) },
      {
        label: "secondBrain.sessionTab.subagents",
        value: subagentSpend(),
      },
      {
        label: "context.stats.sessionCreated",
        value: info()?.time.created ? formatter().time(info()?.time.created) : undefined,
      },
      {
        label: "context.stats.lastActivity",
        value: c ? formatter().time(c.message.time.created) : undefined,
      },
    ]
    return rows.flatMap((row) => (row.value ? [{ label: row.label, value: row.value }] : []))
  })

  const [raw, setRaw] = createSignal(false)

  const exportSession = async () => {
    const sessionID = params.id
    if (!sessionID) return
    try {
      const data = await fetchSessionExport({
        sessionID,
        client: sdk().client,
        messageApi: (await sdk().protocol) === "v2" ? sdk().api.message : undefined,
      })
      const filename = sessionExportFilename(data.info)
      if (!platform.saveSessionExport) {
        downloadSessionExport(filename, data)
        return // Browsers cannot report whether the save dialog completed.
      }
      if (!(await platform.saveSessionExport({ filename, json: JSON.stringify(data, null, 2) }))) return
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = view().scroll("context")
    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return

      view().setScroll("context", next)
    })
  }

  createEffect(
    on(
      () => messages().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <ScrollView
      class="@container h-full"
      viewportRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <div class="px-4 pt-2 pb-10 flex flex-col gap-4">
        <Show when={harnessOptions().length > 1}>
          <div class="flex items-center justify-between gap-3 rounded-[16px] bg-v2-background-bg-layer-01 py-1.5 pl-3 pr-1.5">
            <div class="text-[12px] text-v2-text-text-muted">{language.t("harness.label")}</div>
            <SelectV2
              appearance="inline"
              options={harnessOptions()}
              current={harnessOptions().find((item) => item.id === selectedHarness())}
              value={(item) => item.id}
              label={(item) => item.label}
              placement="bottom-end"
              gutter={6}
              onSelect={(item) => item && setSelectedHarness(item.id)}
            />
          </div>
        </Show>

        {/* The Details workshop's variant C: the context window first, then what takes the most room in it. */}
        <section
          data-slot="session-tab-context"
          aria-label={language.t("secondBrain.sessionTab.contextTitle")}
          class="flex flex-col gap-2.5"
        >
          <div class="flex items-baseline gap-2">
            <h3 class="m-0 flex-1 text-[15px] leading-5 [font-weight:600] text-v2-text-text-base">
              {language.t("secondBrain.sessionTab.contextTitle")}
            </h3>
            <Show
              when={!ctx()?.compacted}
              fallback={
                <span class="text-[12.5px] text-v2-text-text-muted">
                  {language.t("secondBrain.sessionTab.compacted")}
                </span>
              }
            >
              <span class="text-[13px] [font-weight:560] tabular-nums text-v2-text-text-base">
                {compactNumber(ctx()?.total)}
              </span>
              <Show when={ctx()?.limit}>
                <span class="text-[12.5px] tabular-nums text-v2-text-text-muted">
                  {`/ ${compactNumber(ctx()?.limit)} · ${formatter().percent(ctx()?.usage)}`}
                </span>
              </Show>
            </Show>
          </div>
          <Show when={breakdownGroups().length > 0}>
            {/* The estimated parts, scaled to the window, so what's left reads as free. */}
            <div
              class="flex h-2.5 overflow-hidden rounded-full bg-v2-background-bg-layer-02"
              role="img"
              aria-label={breakdownGroups()
                .map((segment) => `${breakdownLabel(segment.key)} ${Math.round(windowShare(segment.width))}%`)
                .join(", ")}
            >
              <For each={breakdownGroups()}>
                {(segment) => (
                  <span
                    class={`h-full ${BREAKDOWN_SHADE[segment.key]}`}
                    style={{ width: `${windowShare(segment.width)}%` }}
                  />
                )}
              </For>
            </div>
            <div class="flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] leading-4 text-v2-text-text-muted">
              <For each={breakdownGroups()}>
                {(segment) => (
                  <span class="inline-flex items-center gap-1.5">
                    <span class={`size-2 rounded-[2px] ${BREAKDOWN_SHADE[segment.key]}`} aria-hidden="true" />
                    {`${breakdownLabel(segment.key)} ${Math.round(windowShare(segment.width)).toLocaleString(language.intl())}%`}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </section>

        <Show
          when={subagentCards().length > 0}
          fallback={
            <Show when={heaviest().length > 0}>
              <section data-slot="session-tab-heaviest" class="flex flex-col gap-2">
                <div class="flex items-baseline gap-2">
                  <h3 class="m-0 flex-1 text-[13px] leading-[18px] [font-weight:600] text-v2-text-text-base">
                    {language.t("secondBrain.sessionTab.heaviest")}
                  </h3>
                  <span class="text-[12px] text-v2-text-text-muted">
                    {language.t("secondBrain.sessionTab.estimated")}
                  </span>
                </div>
                <For each={heaviest()}>
                  {(item) => (
                    <button
                      type="button"
                      data-slot="session-tab-heavy-item"
                      class="flex w-full min-w-0 flex-col gap-1.5 rounded-[14px] bg-v2-background-bg-layer-01 px-3 py-2.5 text-left transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-02 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                      onClick={() => revealTurn(item.turnID)}
                    >
                      <span class="flex min-w-0 items-baseline gap-2 text-[12.5px] leading-[18px]">
                        <span class="min-w-0 flex-1 truncate text-v2-text-text-base">{item.name}</span>
                        <span class="shrink-0 tabular-nums text-v2-text-text-base">{compactNumber(item.tokens)}</span>
                      </span>
                      <span
                        class="block h-[5px] overflow-hidden rounded-full bg-v2-background-bg-layer-03"
                        aria-hidden="true"
                      >
                        <span
                          class="block h-full rounded-full bg-v2-icon-icon-accent/55"
                          style={{ width: `${(item.tokens / heaviest()[0]!.tokens) * 100}%` }}
                        />
                      </span>
                      <span class="text-[11.5px] leading-4 text-v2-text-text-muted">
                        {`${language.t("secondBrain.sessionTab.turn", { turn: item.turn })} · ${language.t(`secondBrain.sessionTab.kind.${item.kind}`)}`}
                      </span>
                    </button>
                  )}
                </For>
                <p class="m-0 px-1 text-[12px] leading-4 text-v2-text-text-muted">
                  {language.t("secondBrain.sessionTab.heaviestHint")}
                </p>
                <ButtonV2
                  size="small"
                  variant="neutral"
                  class="self-start"
                  onClick={() => command.trigger("session.compact")}
                >
                  {language.t("secondBrain.sessionTab.compactNow")}
                </ButtonV2>
              </section>
            </Show>
          }
        >
          <SubagentCards
            rows={subagentCards()}
            onOpen={
              data.openSubagent ? (row) => data.openSubagent?.({ sessionID: row.sessionID, partID: row.id }) : undefined
            }
            onReveal={revealTurn}
          />
          <ButtonV2
            size="small"
            variant="neutral"
            class="-mt-2 self-start"
            onClick={() => command.trigger("session.compact")}
          >
            {language.t("secondBrain.sessionTab.compactNow")}
          </ButtonV2>
        </Show>

        <div class="h-px bg-v2-border-border-muted" />

        <section
          data-slot="session-tab-details"
          class="flex flex-col gap-2.5 text-[12.5px] leading-[18px] text-v2-text-text-base"
        >
          <h3 class="m-0 text-[13px] [font-weight:600]">{language.t("secondBrain.sessionTab.thread")}</h3>
          <dl class="m-0 grid grid-cols-[112px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5">
            <Show when={ctx()}>
              <dt class="text-v2-text-text-muted">{language.t("context.stats.model")}</dt>
              <dd class="m-0 min-w-0 truncate">{modelLabel()}</dd>
            </Show>
            <dt class="text-v2-text-text-muted">{language.t("harness.label")}</dt>
            <dd class="m-0 min-w-0 truncate">{selectedHarness() ? harnessLabel(selectedHarness()!) : "—"}</dd>
            <dt class="text-v2-text-text-muted">{language.t("context.stats.messages")}</dt>
            <dd class="m-0 min-w-0 truncate">
              {subagents().length > 0
                ? language.t("secondBrain.sessionTab.messagesWithSubagents", {
                    messages: counts().all.toLocaleString(language.intl()),
                    subagents: subagents().length,
                  })
                : counts().all.toLocaleString(language.intl())}
            </dd>
          </dl>
          <button
            type="button"
            aria-expanded={usageOpen()}
            class="-ml-1 inline-flex items-center gap-1 self-start rounded-[8px] px-1 py-0.5 text-[12.5px] text-v2-text-text-muted outline-none hover:text-v2-text-text-base focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)]"
            onClick={() => setUsageOpen((open) => !open)}
          >
            {language.t("secondBrain.sessionTab.usageAndCost")}
            <Icon
              name="chevron-down"
              size="small"
              class="transition-transform duration-short ease-standard motion-reduce:transition-none"
              classList={{ "rotate-180": usageOpen() }}
            />
          </button>
          <Reveal open={usageOpen()}>
            <div class="flex flex-col gap-2.5">
              <dl class="m-0 grid grid-cols-[112px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 tabular-nums">
                <For each={details().filter((row) => row.label !== "context.stats.model")}>
                  {(row) => (
                    <>
                      <dt class="text-v2-text-text-muted">{language.t(row.label)}</dt>
                      <dd class="m-0 min-w-0 truncate">{row.value}</dd>
                    </>
                  )}
                </For>
              </dl>
              <Show when={toolPhrases().length > 0}>
                <p class="m-0 text-v2-text-text-muted">{toolPhrases().join(" · ")}</p>
              </Show>
              <Show when={perHarness()}>
                <p class="m-0 text-[12px] text-v2-text-text-muted">
                  {language.t("secondBrain.sessionTab.loadedTotals")}
                </p>
              </Show>
              <Show when={subagentUsage()?.missing}>
                {(missing) => (
                  <p class="m-0 text-[12px] text-v2-text-text-muted">
                    {language.plural("secondBrain.sessionTab.subagentsMissing", missing(), {
                      count: missing().toLocaleString(language.intl()),
                    })}
                  </p>
                )}
              </Show>
            </div>
          </Reveal>
        </section>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <section class="flex flex-col gap-2">
              <h3 class="m-0 text-[13px] leading-[18px] [font-weight:600] text-v2-text-text-base">
                {language.t("context.systemPrompt.title")}
              </h3>
              <div class="rounded-[14px] bg-v2-background-bg-layer-01 px-3 py-2">
                <Markdown text={prompt()} class="text-[12px]" />
              </div>
            </section>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <ButtonV2 variant="outline" size="small" aria-expanded={raw()} onClick={() => setRaw((value) => !value)}>
              {language.t("context.rawMessages.title")}
            </ButtonV2>
            <ButtonV2 variant="ghost" size="small" class="gap-1.5" onClick={exportSession}>
              <Icon name="download" />
              <span>{language.t("context.export.session")}</span>
            </ButtonV2>
          </div>
          <Show when={raw()}>
            <AccordionV2 multiple class="thread-collapsibles">
              <For each={messages()}>
                {(message) => (
                  <RawMessage
                    message={message}
                    getParts={getParts}
                    onRendered={restoreScroll}
                    time={formatter().time}
                  />
                )}
              </For>
            </AccordionV2>
          </Show>
        </div>
      </div>
    </ScrollView>
  )
}
