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
import { getSessionContext } from "@/components/session/session-context-metrics"
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
import { useSessionLayout } from "@/pages/session/session-layout"
import { listHarnessUsage } from "@/utils/server"
import { cachedUsage, rememberUsage } from "@/components/harness-usage"
import { PromptBranchPicker } from "@/components/prompt-workspace-selector"
import { formatResetIn, threadUsage, threadWorktree } from "./context-strip-model"
import { changeTotals, connectorRows, runningSubagents, shortFolder } from "./environment-model"
import type { SubagentGroup } from "@/components/session/subagent-list"
import { useServerSync } from "@/context/server-sync"
import { usePermission } from "@/context/permission"
import { useTerminal } from "@/context/terminal"
import { useDialog } from "@tenon/ui/context/dialog"
import { DialogSettings } from "@/components/settings-v2/dialog-settings-v2"

/** The harnesses the composer knows: the thread's own harness and every harness's display name. */
type ComposerHarness = {
  current: () => Harness.InstanceID
  instances: () => ReadonlyArray<Harness.Instance> | undefined
}

// The server caches each harness's usage for a minute, so the open menu asks no more often than that.
const USAGE_REFRESH_MS = 60_000

export type ComposerContext = ReturnType<typeof createComposerContext>

/** The thread's messages and its context-window use, for the composer's context ring and menu. */
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
  // The server keeps whole-session totals on the session info; the loaded messages may be only part of the thread.
  const totals = createMemo(() => getSessionTotals(params.id ? sync().session.get(params.id) : undefined, messages()))
  const subagents = createMemo(() => getSubagentUsage(messages(), parts, (id) => sync().session.get(id)))
  // Each subagent's own context, beside the main agent's: a `task` child reads its last step once loaded.
  const agents = createMemo(() =>
    latestSubagentContexts(messages(), parts, (id) => {
      const child = getSessionContext(sync().data.message[id] ?? [], [...providers.all().values()])
      return child?.reported ? { used: child.total, size: child.limit } : undefined
    }),
  )
  return { messages, context, totals, subagents, agents }
}

/**
 * The composer's context ring: it fills with the share of the context window used and opens the thread's
 * environment summary: where it runs (harness and model, folder, branch, approval mode), the context window, this
 * turn, the thread's cost and subagent spend, its MCP servers, its file changes, what is running, and the harness's
 * plan limits.
 */
export function ComposerContextRing(props: {
  context: ComposerContext
  harness?: ComposerHarness
  /** The thread's subagent groups, for the Running line. */
  subagents?: () => SubagentGroup[]
}) {
  const language = useLanguage()
  const { params } = useSessionLayout()
  const [state, setState] = createStore({ open: false })
  const usage = createPlanUsage(() => state.open)
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const label = () => {
    const value = props.context.context()
    if (!value) return ""
    if (value.compacted) return language.t("secondBrain.contextStrip.ringCompacted")
    if (!value.reported) return language.t("secondBrain.contextMenu.notReported")
    if (value.usage === null)
      return language.t("secondBrain.contextStrip.ringTokens", { count: formatter().number(value.total) })
    return language.t("secondBrain.contextStrip.ring", { percent: formatter().percent(value.usage) })
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
              <ProgressCircleV2 percentage={value().compacted ? 0 : (value().usage ?? 0)} />
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
            subagentGroups={props.subagents?.() ?? []}
            onView={() => setState("open", false)}
          />
        </Popover>
      )}
    </Show>
  )
}

/**
 * Where the thread runs, for the composer's header: its folder (marked when it's a linked worktree) and its branch,
 * which opens the branch picker. A thread's folder is fixed, so unlike a new thread there's no worktree switch.
 */
export function ComposerWhereRow() {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const { params } = useSessionLayout()
  const directory = () => (params.id ? sync().session.get(params.id)?.directory : undefined) ?? sdk().directory
  const worktree = createMemo(() => threadWorktree({ directory: directory(), project: sync().project }))
  const git = () => sync().project?.vcs === "git"
  // Picking another Project starts a new thread there; this thread keeps its own folder.
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

/**
 * The context menu's list: how much of the context window is used, what the latest turn read from cache, the
 * thread's whole cost and what its subagents spent, and the thread's harness's plan limits. A window the harness doesn't report shows tokens without a share.
 */
function ContextMenu(props: {
  open: boolean
  context: NonNullable<ReturnType<ComposerContext["context"]>>
  messages: ReturnType<ComposerContext["messages"]>
  cost: number | undefined
  subagents: ReturnType<ComposerContext["subagents"]>
  agents: ReturnType<ComposerContext["agents"]>
  harness?: ComposerHarness
  usage: PlanUsage
  subagentGroups: SubagentGroup[]
  onView: () => void
}) {
  const language = useLanguage()
  const layout = useLayout()
  const { tabs, view } = useSessionLayout()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }))
  const turn = createMemo(() => getTurnUsage(props.messages))
  const limit = () => props.context.limit || undefined
  const percent = (value: number) => `${Math.round(value)}%`

  return (
    <div
      data-component="context-menu"
      aria-label={language.t("secondBrain.contextStrip.sheet")}
      class="flex flex-col text-[13px] leading-[18px] tabular-nums text-v2-text-text-base"
    >
      <EnvironmentGroup harness={props.harness} model={props.context.modelLabel} />

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
            when={props.context.reported && limit()}
            fallback={
              <>
                <Row label={language.t("secondBrain.contextMenu.used")}>
                  {/* Without a live report the only figure is the turn's total over every model call, shown below. */}
                  <Show
                    when={props.context.reported}
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
            {(max) => (
              <Row label={language.t("secondBrain.contextMenu.used")}>
                <span class="truncate text-[12px] [font-weight:400] text-v2-text-text-muted">
                  {language.t("secondBrain.sessionTab.contextUsed", {
                    used: formatter().number(props.context.total),
                    limit: formatter().number(max()),
                  })}
                </span>
                <Meter value={props.context.usage ?? 0} />
                <span class="w-[34px] text-right">{percent(props.context.usage ?? 0)}</span>
              </Row>
            )}
          </Show>
        </Show>
      </Group>

      <Show when={props.agents.length > 0}>
        <Group title={language.t("secondBrain.contextMenu.subagentContext")}>
          <For each={props.agents}>
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

      <ConnectorsGroup harness={props.harness} onManage={props.onView} />
      <ChangesGroup onReview={props.onView} />
      <RunningGroup groups={props.subagentGroups} />

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

/**
 * The harness plan-limit reports for the context menu, loaded as soon as the ring shows (not when the menu opens),
 * kept between openings, and asked again when the menu opens a minute or more after the last check and once a
 * minute while it stays open. It starts from the last answer in local storage, so the menu opens with its bars
 * already drawn and they move to the new values in place.
 */
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

/**
 * The plan limits the thread's own harness reports, one row per window with its reset time. Until the first
 * answer for this harness arrives the group stays out rather than showing a loading line.
 */
function PlanLimits(props: { usage: PlanUsage; harness?: ComposerHarness }) {
  const language = useLanguage()
  const state = props.usage
  // Only the thread's own harness; one that doesn't report usage (OpenCode without a Go plan) shows nothing.
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

/** Where the thread runs: its harness and model, folder, branch and the approval mode that answers its requests. */
function EnvironmentGroup(props: { harness?: ComposerHarness; model: string }) {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const serverSync = useServerSync()
  const permission = usePermission()
  const { params } = useSessionLayout()
  const directory = () => (params.id ? sync().session.get(params.id)?.directory : undefined) ?? sdk().directory
  const harness = () => props.harness?.instances()?.find((item) => item.id === props.harness?.current())?.name
  const branch = () => (sync().project?.vcs === "git" ? sync().data.vcs?.branch : undefined)
  const mode = () => permission.mode(params.id, sdk().directory)
  return (
    <Group title={language.t("secondBrain.environment.title")}>
      <Row label={language.t("secondBrain.environment.harness")}>
        <span class="min-w-0 truncate">{[harness(), props.model].filter(Boolean).join(" · ")}</span>
      </Row>
      <Row label={language.t("secondBrain.environment.folder")}>
        <PathTooltip
          placement="top"
          class="min-w-0"
          name={language.t("secondBrain.environment.folder")}
          path={directory()}
        >
          <span class="min-w-0 truncate font-mono text-[12px] [font-weight:400]">
            {shortFolder(directory(), serverSync().data.path?.home)}
          </span>
        </PathTooltip>
      </Row>
      <Row label={language.t("secondBrain.environment.branch")}>
        <span class="min-w-0 truncate font-mono text-[12px] [font-weight:400]">
          {branch() ?? language.t("secondBrain.environment.noBranch")}
        </span>
      </Row>
      <Row label={language.t("secondBrain.environment.approvals")}>
        {language.t(`secondBrain.permissionMode.${mode()}` as Parameters<typeof language.t>[0])}
      </Row>
    </Group>
  )
}

/**
 * The MCP servers the thread's agent can use: the user's from Settings, on or off, and for Codex and the ACP agents
 * Tenon's own server. Whether an external agent connected each one isn't reported, so only on and off are shown.
 */
function ConnectorsGroup(props: { harness?: ComposerHarness; onManage: () => void }) {
  const language = useLanguage()
  const serverSync = useServerSync()
  const dialog = useDialog()
  const external = () => {
    const current = props.harness?.instances()?.find((item) => item.id === props.harness?.current())
    return !!current && current.driver !== Harness.OpenCodeDriver
  }
  const rows = createMemo(() =>
    connectorRows(serverSync().data.config.mcp as Parameters<typeof connectorRows>[0], external()),
  )
  return (
    <Group title={language.t("secondBrain.environment.connectors")}>
      <Show
        when={rows().length > 0}
        fallback={
          <Row label={language.t("secondBrain.environment.noConnectors")}>
            <span />
          </Row>
        }
      >
        <For each={rows()}>
          {(row) => (
            <Row label={row.builtIn ? language.t("secondBrain.environment.tenonTools") : row.name}>
              <span class="flex items-center gap-1.5 text-[12px] [font-weight:400] text-v2-text-text-muted">
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  classList={{ "bg-v2-state-fg-success": row.on, "bg-v2-border-border-strong": !row.on }}
                  aria-hidden="true"
                />
                {language.t(row.on ? "secondBrain.environment.on" : "secondBrain.environment.off")}
              </span>
            </Row>
          )}
        </For>
      </Show>
      <LinkRow
        label={language.t("secondBrain.environment.manage")}
        onClick={() => {
          props.onManage()
          void dialog.show(() => <DialogSettings defaultValue="mcp" />)
        }}
      />
    </Group>
  )
}

/** The thread's file changes in one line, with the review panel one click away. */
function ChangesGroup(props: { onReview: () => void }) {
  const language = useLanguage()
  const sync = useSync()
  const { params, view, tabs } = useSessionLayout()
  const totals = createMemo(() => changeTotals(params.id ? sync().data.session_diff[params.id] : undefined))
  return (
    <Group title={language.t("secondBrain.environment.changes")}>
      <Show
        when={totals().files > 0}
        fallback={
          <Row label={language.t("secondBrain.environment.noChanges")}>
            <span />
          </Row>
        }
      >
        <Row label={language.t("secondBrain.environment.files", { count: totals().files })}>
          <span class="font-mono text-[12px] [font-weight:400]">
            <Show when={totals().additions > 0}>
              <span class="text-v2-state-fg-success">{`+${totals().additions}`}</span>
            </Show>
            <Show when={totals().additions > 0 && totals().deletions > 0}> </Show>
            <Show when={totals().deletions > 0}>
              <span class="text-v2-state-fg-danger">{`-${totals().deletions}`}</span>
            </Show>
          </span>
        </Row>
        <LinkRow
          label={language.t("secondBrain.environment.review")}
          onClick={() => {
            props.onReview()
            view().reviewPanel.open("other")
            void tabs().open("review")
            tabs().setActive("review")
          }}
        />
      </Show>
    </Group>
  )
}

/** What the thread has running now: its subagents and the open terminals. */
function RunningGroup(props: { groups: SubagentGroup[] }) {
  const language = useLanguage()
  const terminal = useTerminal()
  const subagents = () => runningSubagents(props.groups)
  const terminals = () => terminal.all().length
  return (
    <Group title={language.t("secondBrain.environment.running")}>
      <Row label={language.t("secondBrain.environment.subagents")}>{subagents()}</Row>
      <Row label={language.t("secondBrain.environment.terminals")}>{terminals()}</Row>
    </Group>
  )
}

/** A full-width row that opens something, with a chevron. */
function LinkRow(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="-mx-3 flex min-h-8 items-center px-3 text-left text-v2-text-text-base outline-none transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
      onClick={() => props.onClick()}
    >
      {props.label}
      <Icon name="chevron-down" size="small" class="ml-auto shrink-0 -rotate-90 text-v2-icon-icon-muted" />
    </button>
  )
}

/** A titled group of rows on its own surface. */
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

/** A label on the left and its value on the right; the value may hold extra detail, a meter and a percentage. */
function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-8 items-center gap-2.5">
      <span class="shrink-0 text-v2-text-text-muted">{props.label}</span>
      <span class="ml-auto flex min-w-0 items-center justify-end gap-2 font-[500]">{props.children}</span>
    </div>
  )
}

/** A small accent meter for a share from 0 to 100. */
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
