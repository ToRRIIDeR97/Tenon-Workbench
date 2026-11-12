import { Icon } from "@tenon/ui/v2/icon"
import { PathTooltip } from "@tenon/ui/v2/tooltip-v2"
import { useDialog } from "@tenon/ui/context/dialog"
import { Harness } from "@tenon/schema/harness"
import { createMediaQuery } from "@solid-primitives/media"
import { For, Show, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { ComposerContext } from "@/components/prompt-input/context-strip"
import { changeTotals, connectorRows, runningSubagents, shortFolder } from "@/components/prompt-input/environment-model"
import { createSessionContextFormatter } from "@/components/session/session-context-format"
import type { SubagentGroup } from "@/components/session/subagent-list"
import { DialogSettings } from "@/components/settings-v2/dialog-settings-v2"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { useSessionLayout } from "@/pages/session/session-layout"
import { Persist, persisted } from "@/utils/persist"

type ThreadHarness = {
  current: () => Harness.InstanceID
  instances: () => ReadonlyArray<Harness.Instance> | undefined
}

/**
 * The thread's environment, floating at the top right of the thread while the side panel is closed: where it runs
 * (harness and model, folder, branch, approval mode), its context use, its MCP servers, its file changes and what is
 * running. The header folds it to a small pill; that choice is kept. On a window too narrow to show it beside the
 * messages it starts folded until opened.
 */
export function ThreadEnvironment(props: {
  context: ComposerContext
  harness?: ThreadHarness
  subagents: () => SubagentGroup[]
}) {
  const language = useLanguage()
  const wide = createMediaQuery("(min-width: 1600px)")
  const [prefs, setPrefs] = persisted(
    Persist.global("thread.environment"),
    createStore({ open: undefined as boolean | undefined }),
  )
  const open = () => prefs.open ?? wide()

  return (
    <aside
      data-component="thread-environment"
      aria-label={language.t("secondBrain.environment.title")}
      class="pointer-events-auto absolute right-3 top-14 z-30 flex max-h-[min(640px,calc(100vh-280px))] flex-col overflow-hidden rounded-[20px] bg-v2-background-bg-floating text-[13px] leading-[18px] text-v2-text-text-base shadow-[var(--v2-elevation-floating)]"
      classList={{ "w-[300px]": open() }}
    >
      <button
        type="button"
        aria-expanded={open()}
        class="flex h-10 shrink-0 items-center gap-2 px-4 text-left type-control outline-none transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
        onClick={() => setPrefs("open", !open())}
      >
        <span class="flex-1">{language.t("secondBrain.environment.title")}</span>
        <Icon
          name="chevron-down"
          size="small"
          class="shrink-0 text-v2-icon-icon-muted transition-transform duration-short ease-standard motion-reduce:transition-none"
          classList={{ "rotate-180": open() }}
        />
      </button>
      <Show when={open()}>
        <div class="flex min-h-0 flex-col gap-1 overflow-y-auto px-1.5 pb-1.5 tabular-nums">
          <WhereGroup harness={props.harness} model={props.context.context()?.modelLabel} />
          <ContextGroup context={props.context} />
          <ConnectorsGroup harness={props.harness} />
          <ChangesGroup />
          <RunningGroup groups={props.subagents()} />
        </div>
      </Show>
    </aside>
  )
}

function currentHarness(harness?: ThreadHarness) {
  return harness?.instances()?.find((item) => item.id === harness.current())
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
    <Group>
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

/** How full the context window is, as the composer's ring shows it, with the tokens behind the share. */
function ContextGroup(props: { context: ComposerContext }) {
  const language = useLanguage()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
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
              <div class="flex flex-col gap-1.5 py-2">
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
                <span class="block h-1.5 overflow-hidden rounded-full bg-v2-background-bg-layer-04" aria-hidden="true">
                  <span
                    class="block h-full rounded-full bg-v2-icon-icon-accent transition-[width] duration-medium ease-standard motion-reduce:transition-none"
                    style={{ width: `${Math.min(100, Math.max(0, reported().usage ?? 0))}%` }}
                  />
                </span>
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
  const external = () => {
    const current = currentHarness(props.harness)
    return !!current && current.driver !== Harness.OpenCodeDriver
  }
  const rows = createMemo(() =>
    connectorRows(serverSync().data.config.mcp as Parameters<typeof connectorRows>[0], external()),
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
function RunningGroup(props: { groups: SubagentGroup[] }) {
  const language = useLanguage()
  const terminal = useTerminal()
  return (
    <Group title={language.t("secondBrain.environment.running")}>
      <Row label={language.t("secondBrain.environment.subagents")}>{runningSubagents(props.groups)}</Row>
      <Row label={language.t("secondBrain.environment.terminals")}>{terminal.all().length}</Row>
    </Group>
  )
}

/** A group of rows on its own surface, with an optional title above it. */
function Group(props: { title?: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col">
      <Show when={props.title}>
        <h3 class="m-0 px-3 pb-1 pt-2 type-caption uppercase tracking-[0.05em] text-v2-text-text-muted">
          {props.title}
        </h3>
      </Show>
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
