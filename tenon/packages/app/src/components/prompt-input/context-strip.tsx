import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { ProgressCircleV2 } from "@tenon/ui/v2/progress-circle-v2"
import { PathTooltip, TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { Popover } from "@tenon/ui/popover"
import { Harness } from "@tenon/schema/harness"
import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, onMount, untrack, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { openSessionContext } from "@/components/session-context-usage"
import { createSessionContextFormatter } from "@/components/session/session-context-format"
import { PromptProjectSelector, createPromptProjectController } from "@/components/prompt-project-selector"
import { createPromptProjectControls } from "@/pages/session/composer/session-composer-controls"
import { contextReadout, getSessionContext } from "@/components/session/session-context-metrics"
import {
  getSessionTotals,
  getSubagentUsage,
  getTurnUsage,
  latestSubagentContexts,
} from "@/components/session/session-usage"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import { AGENTS_TAB } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { listHarnessUsage } from "@/utils/server"
import { cachedUsage, rememberUsage } from "@/components/harness-usage"
import { PromptBranchPicker } from "@/components/prompt-workspace-selector"
import { formatResetIn, threadUsage, threadWorktree } from "./context-strip-model"

type ComposerHarness = {
  current: () => Harness.InstanceID
  instances: () => ReadonlyArray<Harness.Instance> | undefined
}

const USAGE_REFRESH_MS = 60_000

export type ComposerContext = ReturnType<typeof createComposerContext>

export function createComposerContext() {
  const sync = useSync()
  const sdk = useSDK()
  const providers = useProviders(() => sdk().directory)
  const { params } = useSessionLayout()
  const messages = createMemo(() => (params.id ? (sync().data.message[params.id] ?? []) : []))
  const parts = (messageID: string) => sync().data.part[messageID] ?? []
  const context = createMemo(() =>
    getSessionContext(messages(), [...providers.all().values()], undefined, (id) => sync().data.part[id]),
  )
  const totals = createMemo(() => getSessionTotals(params.id ? sync().session.get(params.id) : undefined, messages()))
  const subagents = createMemo(() => getSubagentUsage(messages(), parts, (id) => sync().session.get(id)))
  const agents = createMemo(() =>
    latestSubagentContexts(messages(), parts, (id) => {
      const child = getSessionContext(
        sync().data.message[id] ?? [],
        [...providers.all().values()],
        undefined,
        (messageID) => sync().data.part[messageID],
      )
      return child?.reported ? { used: child.total, size: child.limit } : undefined
    }),
  )
  return { messages, context, totals, subagents, agents }
}

export function ComposerContextRing(props: { context: ComposerContext; harness?: ComposerHarness }) {
  const language = useLanguage()
  const { params } = useSessionLayout()
  const [state, setState] = createStore({ open: false })
  const usage = createPlanUsage(() => state.open)
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const readout = createMemo(() => contextReadout(props.context.context()))
  const label = () => {
    const value = readout()
    if (value.kind === "none") return ""
    if (value.kind === "compacted") return language.t("secondBrain.contextStrip.ringCompacted")
    if (value.kind === "unreported") return language.t("secondBrain.contextMenu.notReported")
    if (value.kind === "tokens")
      return language.t("secondBrain.contextStrip.ringTokens", { count: formatter().number(value.tokens) })
    return language.t("secondBrain.contextStrip.ring", { percent: formatter().percent(value.percent) })
  }
  createEffect(() => !props.context.context() && setState("open", false))

  return (
    <Show when={params.id ? props.context.context() : undefined}>
      {(value) => (
        <Popover
          open={state.open}
          onOpenChange={(open) => setState("open", open)}
          placement="top-end"
          gutter={8}
          class="w-[clamp(320px,24vw,380px)] max-w-[calc(100vw-32px)] [&_[data-slot=popover-body]]:p-1.5"
          triggerAs={IconButtonV2}
          triggerProps={{
            type: "button",
            "data-action": "context-ring",
            variant: "ghost-muted",
            size: "large",
            state: state.open ? "pressed" : undefined,
            "aria-label": label(),
          }}
          trigger={
            <span class="flex items-center justify-center">
              <ProgressCircleV2
                percentage={(() => {
                  const current = readout()
                  return current.kind === "share" ? current.percent : 0
                })()}
              />
            </span>
          }
        >
          <ContextMenu
            open={state.open}
            context={value()}
            messages={props.context.messages()}
            cost={props.context.totals().cost}
            subagents={props.context.subagents()}
            agents={props.context.agents()}
            harness={props.harness}
            usage={usage}
            onView={() => setState("open", false)}
          />
        </Popover>
      )}
    </Show>
  )
}

export function ComposerWhereRow() {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const { params } = useSessionLayout()
  const directory = () => (params.id ? sync().session.get(params.id)?.directory : undefined) ?? sdk().directory
  const worktree = createMemo(() => threadWorktree({ directory: directory(), project: sync().project }))
  const git = () => sync().project?.vcs === "git"
  const projects = createPromptProjectController({ controls: createPromptProjectControls(), onDone: () => {} })

  return (
    <>
      <Show when={worktree()}>
        {(value) => (
          <>
            <PromptProjectSelector controller={projects} placement="bottom-start" />
            <Show when={value().linked}>
              <PathTooltip placement="top" class="min-w-0 shrink" name={value().name} path={directory()}>
                <span
                  data-slot="composer-where-folder"
                  class="flex h-8 min-w-0 shrink items-center gap-1.5 px-2 text-[13px] leading-5 text-v2-text-text-muted"
                >
                  <span class="shrink-0">{language.t("secondBrain.contextStrip.worktree")}</span>
                  <span class="min-w-0 truncate text-v2-text-text-base [font-weight:500]">{value().name}</span>
                </span>
              </PathTooltip>
            </Show>
          </>
        )}
      </Show>
      <Icon name="chevron-down" size="small" class="shrink-0 -rotate-90 text-v2-icon-icon-muted" />
      <PromptBranchPicker directory={directory()} branch={git() ? sync().data.vcs?.branch : undefined} noGit={!git()} />
    </>
  )
}

function ContextMenu(props: {
  open: boolean
  context: NonNullable<ReturnType<ComposerContext["context"]>>
  messages: ReturnType<ComposerContext["messages"]>
  cost: number | undefined
  subagents: ReturnType<ComposerContext["subagents"]>
  agents: ReturnType<ComposerContext["agents"]>
  harness?: ComposerHarness
  usage: PlanUsage
  onView: () => void
}) {
  const language = useLanguage()
  const layout = useLayout()
  const { tabs, view } = useSessionLayout()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }))
  const turn = createMemo(() => getTurnUsage(props.messages))
  const limit = () => props.context.limit || undefined
  const readout = createMemo(() => contextReadout(props.context))
  const share = () => {
    const value = readout()
    return value.kind === "share" ? value : undefined
  }
  const percent = (value: number) => `${Math.round(value)}%`
  const running = createMemo(() => props.agents.filter((agent) => agent.running))
  const openAgents = () => {
    props.onView()
    view().reviewPanel.open(view().reviewPanel.opened() ? "other" : "context-button")
    tabs().setActive(AGENTS_TAB)
  }

  return (
    <div
      data-component="context-menu"
      aria-label={language.t("secondBrain.contextStrip.sheet")}
      class="flex flex-col text-[13px] leading-[18px] tabular-nums text-v2-text-text-base"
    >
      <Group title={language.t("secondBrain.contextMenu.window")}>
        <Show
          when={!props.context.compacted}
          fallback={
            <Row label={language.t("secondBrain.contextMenu.used")}>
              <span class="truncate text-[12px] [font-weight:400] text-v2-text-text-muted">
                {language.t("secondBrain.contextMenu.compacted")}
              </span>
            </Row>
          }
        >
          <Show
            when={share()}
            fallback={
              <>
                <Row label={language.t("secondBrain.contextMenu.used")}>
                  <Show
                    when={readout().kind !== "unreported"}
                    fallback={
                      <span class="text-v2-text-text-muted">{language.t("secondBrain.contextMenu.notReported")}</span>
                    }
                  >
                    {language.t("secondBrain.contextMenu.usedTokens", {
                      count: formatter().number(props.context.total),
                    })}
                  </Show>
                </Row>
                <Row label={language.t("secondBrain.contextMenu.windowSize")}>
                  <Show
                    when={limit()}
                    fallback={
                      <span class="text-v2-text-text-muted">{language.t("secondBrain.contextMenu.notReported")}</span>
                    }
                  >
                    {(max) => formatter().number(max())}
                  </Show>
                </Row>
              </>
            }
          >
            {(value) => (
              <Row label={language.t("secondBrain.contextMenu.used")}>
                <span class="truncate text-[12px] [font-weight:400] text-v2-text-text-muted">
                  {language.t("secondBrain.sessionTab.contextUsed", {
                    used: formatter().number(value().tokens),
                    limit: formatter().number(value().limit),
                  })}
                </span>
                <Meter value={value().percent} />
                <span class="w-[34px] text-right">{percent(value().percent)}</span>
              </Row>
            )}
          </Show>
        </Show>
      </Group>

      <Show when={running().length > 0}>
        <Group title={language.t("secondBrain.contextMenu.subagentContext")}>
          <For each={running()}>
            {(agent) => (
              <Row label={agent.name ?? language.t("secondBrain.agentTab.agentFallback")}>
                <Show
                  when={agent.used !== undefined}
                  fallback={
                    <span class="text-[12px] font-normal text-v2-text-text-muted">
                      {language.t("secondBrain.contextMenu.notReported")}
                    </span>
                  }
                >
                  <Show
                    when={agent.size}
                    fallback={language.t("secondBrain.contextMenu.usedTokens", {
                      count: formatter().number(agent.used),
                    })}
                  >
                    {(size) => (
                      <>
                        <Meter value={(agent.used! / size()) * 100} />
                        <span class="w-[34px] text-right">{percent((agent.used! / size()) * 100)}</span>
                      </>
                    )}
                  </Show>
                </Show>
              </Row>
            )}
          </For>
          <button
            type="button"
            data-action="context-menu-open-agents"
            class="-mx-3 flex min-h-8 items-center gap-1 px-3 text-left text-[12px] text-v2-text-text-accent outline-none transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
            onClick={openAgents}
          >
            {language.t("secondBrain.contextMenu.openAgents")}
            <Icon name="chevron-down" size="small" class="ml-auto shrink-0 -rotate-90 text-v2-icon-icon-muted" />
          </button>
        </Group>
      </Show>

      <Group title={language.t("secondBrain.contextMenu.turn")}>
        <Show when={turn().cacheHit}>
          {(hit) => (
            <Row label={language.t("secondBrain.contextMenu.cacheHit")}>
              <Meter value={hit() * 100} />
              <span class="w-[34px] text-right">{percent(hit() * 100)}</span>
            </Row>
          )}
        </Show>
        <Show when={turn().total > 0}>
          <Row label={language.t("secondBrain.contextMenu.tokens")}>{formatter().number(turn().total)}</Row>
        </Show>
        <Row label={language.t("harness.model")}>
          <TooltipV2 placement="top" class="min-w-0" value={props.context.modelLabel}>
            <span class="min-w-0 truncate font-mono text-[12px] [font-weight:400]">{props.context.modelLabel}</span>
          </TooltipV2>
        </Row>
      </Group>

      <Show when={props.cost || props.subagents?.count}>
        <Group title={language.t("secondBrain.contextMenu.thread")}>
          <Show when={props.cost}>
            {(amount) => <Row label={language.t("secondBrain.contextMenu.cost")}>{usd().format(amount())}</Row>}
          </Show>
          <Show when={props.subagents?.count ? props.subagents : undefined}>
            {(spent) => (
              <Row label={language.t("secondBrain.contextMenu.subagents")}>
                {spent().cost
                  ? language.t("secondBrain.sessionTab.subagentUsage", {
                      tokens: formatter().number(spent().total),
                      cost: usd().format(spent().cost!),
                    })
                  : language.t("secondBrain.contextMenu.usedTokens", { count: formatter().number(spent().total) })}
              </Row>
            )}
          </Show>
        </Group>
      </Show>

      <PlanLimits usage={props.usage} harness={props.harness} />

      <button
        type="button"
        class="mt-1.5 flex h-9 w-full items-center rounded-[12px] px-3 text-left type-control text-v2-text-text-base outline-none transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
        onClick={() => {
          props.onView()
          openSessionContext({ view: view(), layout, tabs: tabs() })
        }}
      >
        {language.t("context.usage.view")}
        <Icon name="chevron-down" size="small" class="ml-auto shrink-0 -rotate-90 text-v2-icon-icon-muted" />
      </button>
    </div>
  )
}

type PlanUsage = ReturnType<typeof createPlanUsage>

function createPlanUsage(open: () => boolean) {
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const sdk = useSDK()
  const [state, setState] = createStore<{
    reports?: ReadonlyArray<Harness.UsageReport>
    failed: boolean
    now: number
  }>({ failed: false, now: Date.now(), ...cachedUsage() })
  let checked = 0
  const load = () => {
    checked = Date.now()
    listHarnessUsage({ server: serverSDK().server.http, fetch: platform.fetch }, sdk().directory)
      .then((reports) => setState({ ...rememberUsage(reports, Date.now()), failed: false }))
      .catch(() => setState({ failed: true, now: Date.now() }))
  }
  onMount(load)
  createEffect(() => {
    if (!open()) return
    if (Date.now() - checked >= USAGE_REFRESH_MS) untrack(load)
    const timer = setInterval(load, USAGE_REFRESH_MS)
    onCleanup(() => clearInterval(timer))
  })
  return state
}

function PlanLimits(props: { usage: PlanUsage; harness?: ComposerHarness }) {
  const language = useLanguage()
  const state = props.usage
  const report = createMemo(() => threadUsage(state.reports ?? [], props.harness?.current()))
  const shown = () => !!report() || (state.failed && !state.reports)
  const name = () => props.harness?.instances()?.find((item) => item.id === props.harness?.current())?.name ?? ""
  const status = (text: string, title?: string) => (
    <TooltipV2 placement="top" inactive={!title} value={title}>
      <p class="py-2 text-[12px] text-v2-text-text-muted">{text}</p>
    </TooltipV2>
  )

  return (
    <Show when={shown()}>
      <Group title={language.t("secondBrain.contextMenu.limitsFor", { name: name() })}>
        <Show when={report()} fallback={status(language.t("secondBrain.contextStrip.usage.error"))}>
          {(item) => (
            <Switch fallback={status(language.t("secondBrain.contextStrip.usage.unsupported"), item().reason)}>
              <Match when={item().status === "available" && item().windows.length > 0}>
                <For each={item().status === "available" ? item().windows : []}>
                  {(window) => (
                    <Row label={window.label}>
                      <Show when={window.resetsAt}>
                        {(resetsAt) => (
                          <span class="truncate text-[12px] [font-weight:400] text-v2-text-text-muted">
                            {language.t("secondBrain.contextStrip.usage.resets", {
                              time: formatResetIn(resetsAt(), state.now, language.intl()),
                            })}
                          </span>
                        )}
                      </Show>
                      <Meter value={window.usedPercent} />
                      <span class="w-[34px] text-right">{`${Math.round(window.usedPercent)}%`}</span>
                    </Row>
                  )}
                </For>
              </Match>
              <Match when={item().status === "available"}>
                {status(language.t("secondBrain.contextStrip.usage.noLimits"))}
              </Match>
              <Match when={item().status === "signed-out"}>
                {status(item().reason ?? language.t("secondBrain.contextStrip.usage.signedOut"))}
              </Match>
              <Match when={item().status === "error"}>
                {status(language.t("secondBrain.contextStrip.usage.error"), item().reason)}
              </Match>
            </Switch>
          )}
        </Show>
      </Group>
    </Show>
  )
}

function Group(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col">
      <h3 class="m-0 px-3 pb-1 pt-2.5 type-section text-v2-text-text-base">{props.title}</h3>
      <div class="flex flex-col divide-y divide-v2-border-border-muted rounded-[16px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3">
        {props.children}
      </div>
    </section>
  )
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-8 items-center gap-2.5">
      <span class="shrink-0 text-v2-text-text-muted">{props.label}</span>
      <span class="ml-auto flex min-w-0 items-center justify-end gap-2 font-[500]">{props.children}</span>
    </div>
  )
}

function Meter(props: { value: number }) {
  return (
    <span class="block h-1 w-9 shrink-0 overflow-hidden rounded-full bg-v2-background-bg-layer-04" aria-hidden="true">
      <span
        class="block h-full rounded-full bg-v2-icon-icon-accent transition-[width] duration-medium ease-standard motion-reduce:transition-none"
        style={{ width: `${Math.min(100, Math.max(0, props.value))}%` }}
      />
    </span>
  )
}
