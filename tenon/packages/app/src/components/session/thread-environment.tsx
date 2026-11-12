import { Icon } from "@tenon/ui/v2/icon"
import { PathTooltip } from "@tenon/ui/v2/tooltip-v2"
import { Popover } from "@tenon/ui/popover"
import { useDialog } from "@tenon/ui/context/dialog"
import { Harness } from "@tenon/schema/harness"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createComposerContext } from "@/components/prompt-input/context-strip"
import { changeTotals, connectorRows, runningSubagents, shortFolder } from "@/components/prompt-input/environment-model"
import { contextBreakdown, type ContextPartKey } from "@/components/session/context-breakdown-model"
import { createSessionContextFormatter } from "@/components/session/session-context-format"
import { useThreadSubagents } from "@/components/session/subagent-tab"
import { DialogSettings } from "@/components/settings-v2/dialog-settings-v2"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { useSessionLayout } from "@/pages/session/session-layout"

type ThreadHarness = {
  current: () => Harness.InstanceID
  instances: () => ReadonlyArray<Harness.Instance> | undefined
}

/**
 * The thread's environment, opened from a button in the thread's header beside the "…" menu: where it runs
 * (harness and model, folder, branch, approval mode), its context use and what fills it, its MCP servers, its file
 * changes and what is running. It opens and closes with the app's popover motion (scale and fade from its button).
 */
export function ThreadEnvironmentButton(props: { harness?: ThreadHarness }) {
  const language = useLanguage()
  const [state, setState] = createStore({ open: false })
  return (
    <Popover
      open={state.open}
      onOpenChange={(open) => setState("open", open)}
      placement="bottom-end"
      gutter={6}
      class="w-[min(340px,calc(100vw-32px))] [&_[data-slot=popover-body]]:p-1.5"
      triggerAs="button"
      triggerProps={{
        type: "button",
        class:
          "hidden md:flex h-7 items-center gap-1 rounded-full px-2.5 type-control text-v2-text-text-muted outline-none transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base aria-expanded:bg-v2-overlay-simple-overlay-pressed aria-expanded:text-v2-text-text-base focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none",
      }}
      trigger={
        <>
          {language.t("secondBrain.environment.title")}
          <Icon name="chevron-down" size="small" class="shrink-0" />
        </>
      }
    >
      <EnvironmentSections harness={props.harness} />
    </Popover>
  )
}

function EnvironmentSections(props: { harness?: ThreadHarness }) {
  const context = createComposerContext()
  const subagents = useThreadSubagents(() => true)
  return (
    // The scrolling body takes focus when the popover opens (it is the first tab stop), so the keyboard can scroll
    // it and no link inside shows a focus ring on a mouse open.
    <div
      data-component="thread-environment"
      tabIndex={0}
      aria-label={useLanguage().t("secondBrain.environment.title")}
      class="flex max-h-[min(640px,calc(100vh-140px))] flex-col gap-1 overflow-y-auto outline-none text-[13px] leading-[18px] tabular-nums text-v2-text-text-base"
    >
      <WhereGroup harness={props.harness} model={context.context()?.modelLabel} />
      <ContextGroup context={context} harness={props.harness} />
      <ConnectorsGroup harness={props.harness} />
      <ChangesGroup />
      <RunningGroup groups={subagents()} />
    </div>
  )
}

function currentHarness(harness?: ThreadHarness) {
  return harness?.instances()?.find((item) => item.id === harness.current())
}

function isExternal(harness?: ThreadHarness) {
  const current = currentHarness(harness)
  return !!current && current.driver !== Harness.OpenCodeDriver
}

/** Where the thread runs: its harness and model, folder, branch and the approval mode that answers its requests. */
function WhereGroup(props: { harness?: ThreadHarness; model?: string }) {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const serverSync = useServerSync()
  const permission = usePermission()
  const { params } = useSessionLayout()
  const directory = () => (params.id ? sync().session.get(params.id)?.directory : undefined) ?? sdk().directory
  const branch = () => (sync().project?.vcs === "git" ? sync().data.vcs?.branch : undefined)
  const mode = () => permission.mode(params.id, sdk().directory)
  return (
    <Group title={language.t("secondBrain.environment.title")}>
      <Row label={language.t("secondBrain.environment.harness")}>
        <span class="min-w-0 truncate">
          {[currentHarness(props.harness)?.name, props.model].filter(Boolean).join(" · ")}
        </span>
      </Row>
      <Row label={language.t("secondBrain.environment.folder")}>
        <PathTooltip
          placement="left"
          class="min-w-0"
          name={language.t("secondBrain.environment.folder")}
          path={directory()}
        >
          {/* Cut from the start, so the folder's own name stays visible. */}
          <span class="block min-w-0 truncate text-left font-mono text-[12px] [direction:rtl] [font-weight:400]">
            <bdi>{shortFolder(directory(), serverSync().data.path?.home)}</bdi>
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

// One step of the accent or grey per kind, so the parts differ in lightness as well as hue.
const SHADE: Record<ContextPartKey, string> = {
  system: "bg-v2-text-text-muted",
  messages: "bg-v2-icon-icon-accent",
  tools: "bg-v2-icon-icon-accent/55",
  other: "bg-v2-border-border-strong",
  free: "bg-transparent",
}

/**
 * How full the context window is and what fills it. Every harness reports the total; what is in it is estimated
 * from the thread's own text (about four characters a token). For Codex, Claude Code and the other agents, what
 * the thread's text doesn't explain is the agent's own instructions and tool definitions, which Tenon can't see.
 */
function ContextGroup(props: { context: ReturnType<typeof createComposerContext>; harness?: ThreadHarness }) {
  const language = useLanguage()
  const sync = useSync()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const external = () => isExternal(props.harness)
  const parts = createMemo(() => {
    const value = props.context.context()
    if (!value?.reported || value.compacted) return []
    return contextBreakdown({
      messages: props.context.messages(),
      parts: sync().data.part as Record<string, Part[] | undefined>,
      used: value.total,
      limit: value.limit,
    })
  })
  const label = (key: ContextPartKey) => {
    if (key === "system") return language.t("secondBrain.environment.breakdown.system")
    if (key === "messages") return language.t("secondBrain.environment.breakdown.messages")
    if (key === "tools") return language.t("secondBrain.environment.breakdown.tools")
    if (key === "free") return language.t("secondBrain.environment.breakdown.free")
    return external()
      ? language.t("secondBrain.environment.breakdown.agent", { name: currentHarness(props.harness)?.name ?? "" })
      : language.t("secondBrain.environment.breakdown.other")
  }
  const filled = () => parts().filter((part) => part.key !== "free")
  return (
    <Show when={props.context.context()}>
      {(value) => (
        <Group title={language.t("secondBrain.environment.context")}>
          <Show
            when={!value().compacted && value().reported && value().limit ? value() : undefined}
            fallback={
              <Row label={language.t("secondBrain.contextMenu.used")}>
                <span class="text-[12px] [font-weight:400] text-v2-text-text-muted">
                  {value().compacted
                    ? language.t("secondBrain.contextMenu.compacted")
                    : value().reported
                      ? language.t("secondBrain.contextMenu.usedTokens", { count: formatter().number(value().total) })
                      : language.t("secondBrain.contextMenu.notReported")}
                </span>
              </Row>
            }
          >
            {(reported) => (
              <div class="flex flex-col gap-2 py-2">
                <div class="flex items-baseline gap-2">
                  <span class="flex-1 [font-weight:560]">
                    {language.t("secondBrain.contextStrip.ring", {
                      percent: formatter().percent(reported().usage ?? 0),
                    })}
                  </span>
                  <span class="text-[12px] text-v2-text-text-muted">
                    {`${formatter().number(reported().total)} / ${formatter().number(reported().limit!)}`}
                  </span>
                </div>
                <div
                  class="flex h-1.5 overflow-hidden rounded-full bg-v2-background-bg-layer-04"
                  role="img"
                  aria-label={filled()
                    .map((part) => `${label(part.key)} ${Math.round(part.percent)}%`)
                    .join(", ")}
                >
                  <For each={filled()}>
                    {(part) => <span class={`h-full ${SHADE[part.key]}`} style={{ width: `${part.percent}%` }} />}
                  </For>
                </div>
                <div class="flex flex-col gap-1">
                  <For each={parts()}>
                    {(part) => (
                      <div class="flex items-center gap-2 text-[12px]">
                        <span
                          class={`size-2 shrink-0 rounded-[2px] ${part.key === "free" ? "shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]" : SHADE[part.key]}`}
                          aria-hidden="true"
                        />
                        <span
                          class="min-w-0 flex-1 truncate"
                          classList={{ "text-v2-text-text-muted": part.key === "free" }}
                        >
                          {label(part.key)}
                        </span>
                        <span class="text-v2-text-text-muted">{formatter().number(part.tokens)}</span>
                        <span class="w-10 text-right">{`${Math.round(part.percent)}%`}</span>
                      </div>
                    )}
                  </For>
                </div>
                <p class="m-0 text-[11px] leading-[14px] text-v2-text-text-muted">
                  {language.t(
                    external()
                      ? "secondBrain.environment.breakdown.estimatedExternal"
                      : "secondBrain.environment.breakdown.estimated",
                  )}
                </p>
              </div>
            )}
          </Show>
        </Group>
      )}
    </Show>
  )
}

/**
 * The MCP servers the thread's agent can use: the user's from Settings, on or off, and for Codex and the ACP agents
 * Tenon's own server. Whether an external agent connected each one isn't reported, so only on and off are shown.
 */
function ConnectorsGroup(props: { harness?: ThreadHarness }) {
  const language = useLanguage()
  const serverSync = useServerSync()
  const dialog = useDialog()
  const rows = createMemo(() =>
    connectorRows(serverSync().data.config.mcp as Parameters<typeof connectorRows>[0], isExternal(props.harness)),
  )
  return (
    <Group title={language.t("secondBrain.environment.connectors")}>
      <Show when={rows().length > 0} fallback={<Note>{language.t("secondBrain.environment.noConnectors")}</Note>}>
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
        onClick={() => void dialog.show(() => <DialogSettings defaultValue="mcp" />)}
      />
    </Group>
  )
}

/** The thread's file changes in one line, with the review panel one click away. */
function ChangesGroup() {
  const language = useLanguage()
  const sync = useSync()
  const { params, view, tabs } = useSessionLayout()
  const totals = createMemo(() => changeTotals(params.id ? sync().data.session_diff[params.id] : undefined))
  return (
    <Group title={language.t("secondBrain.environment.changes")}>
      <Show when={totals().files > 0} fallback={<Note>{language.t("secondBrain.environment.noChanges")}</Note>}>
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
function RunningGroup(props: { groups: Parameters<typeof runningSubagents>[0] }) {
  const language = useLanguage()
  const terminal = useTerminal()
  return (
    <Group title={language.t("secondBrain.environment.running")}>
      <Row label={language.t("secondBrain.environment.subagents")}>{runningSubagents(props.groups)}</Row>
      <Row label={language.t("secondBrain.environment.terminals")}>{terminal.all().length}</Row>
    </Group>
  )
}

/** A group of rows on its own surface, with a title above it. */
function Group(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col">
      <h3 class="m-0 px-3 pb-1 pt-2 type-caption uppercase tracking-[0.05em] text-v2-text-text-muted">{props.title}</h3>
      <div class="flex flex-col divide-y divide-v2-border-border-muted rounded-[14px] bg-v2-background-bg-layer-01 px-3">
        {props.children}
      </div>
    </section>
  )
}

/** A label on the left and its value on the right. */
function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-8 min-w-0 items-center gap-2.5">
      <span class="shrink-0 text-v2-text-text-muted">{props.label}</span>
      <span class="ml-auto flex min-w-0 items-center justify-end gap-2 [font-weight:500]">{props.children}</span>
    </div>
  )
}

/** A muted one-line note in place of a group's rows. */
function Note(props: { children: JSX.Element }) {
  return <p class="m-0 py-2 text-[12px] text-v2-text-text-muted">{props.children}</p>
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
