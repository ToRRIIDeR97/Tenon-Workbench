import { Icon } from "@tenon/ui/v2/icon"
import { PathTooltip } from "@tenon/ui/v2/tooltip-v2"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { Presence } from "@tenon/ui/v2/presence"
import { useDialog } from "@tenon/ui/context/dialog"
import { Harness } from "@tenon/schema/harness"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
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
import { Persist, persisted } from "@/utils/persist"

/** The window's width, and the narrowest the thread's text may get beside it before the window minimizes. */
const WINDOW_WIDTH = 340
const THREAD_MIN_WIDTH = 480

type ThreadHarness = {
  current: () => Harness.InstanceID
  instances: () => ReadonlyArray<Harness.Instance> | undefined
}

/**
 * The thread's environment: a toggle in the thread's header, beside the "…" menu, opens it as a floating window
 * below the header at the thread's top right. The window stays open while you read and work in the thread (an
 * outside click doesn't close it); the toggle, its close button or Esc inside it close it, and the choice is
 * remembered (`thread.environment`). It opens and closes with the menu motion (scale and fade from the top right).
 * Shows where the thread runs (harness and model, folder, branch, approval mode), its context use and what fills it,
 * its MCP servers, its file changes and what is running.
 */
export function ThreadEnvironmentButton(props: { harness?: ThreadHarness }) {
  const language = useLanguage()
  const [prefs, setPrefs] = persisted(Persist.global("thread.environment"), createStore({ open: false }))
  const [anchor, setAnchor] = createStore({
    top: 0,
    right: 0,
    width: WINDOW_WIDTH,
    inset: 0,
    squeezed: false,
    forced: false,
    placed: false,
  })
  let button: HTMLButtonElement | undefined
  // The window follows its toggle: the thread's header moves and resizes when the side panel opens, closes or is
  // dragged, so it is re-placed whenever the header's size changes (and on a window resize). While it is open the
  // thread's text column moves over to make room for it (`--thread-environment-inset` on the timeline), so the window
  // never covers the thread; when that would leave the thread narrower than THREAD_MIN_WIDTH, the window minimizes
  // to its toggle instead, and comes back once there is room. The toggle still opens it meanwhile (over the thread).
  const place = () => {
    if (!button) return
    const rect = button.getBoundingClientRect()
    const header = button.closest("[data-session-title]")?.getBoundingClientRect()
    const width = Math.min(WINDOW_WIDTH, window.innerWidth - 32)
    const right = Math.max(16, window.innerWidth - rect.right)
    // Room the window takes from the thread: from its left edge to the thread's right edge, plus a gap.
    const inset = header ? Math.max(0, header.right - (rect.right - width) + 12) : 0
    const squeezed = !!header && header.right - header.left - inset < THREAD_MIN_WIDTH
    setAnchor({ placed: true, top: rect.bottom + 6, right, width, inset })
    // Crossing the threshold either way drops a manual open made while squeezed.
    if (squeezed !== anchor.squeezed) setAnchor({ squeezed, forced: false })
  }
  const shown = () => prefs.open && anchor.placed && (!anchor.squeezed || anchor.forced)
  // The timeline reads the inset; a manual open while squeezed floats over the thread instead.
  createEffect(() => {
    const root = button?.closest("[data-session-title]")?.parentElement
    if (!root) return
    const inset = shown() && !anchor.squeezed ? anchor.inset : 0
    root.style.setProperty("--thread-environment-inset", `${inset}px`)
    onCleanup(() => root.style.removeProperty("--thread-environment-inset"))
  })
  createEffect(() => {
    if (!prefs.open) return
    place()
    const header = button?.closest("[data-session-title]")
    const observer = new ResizeObserver(place)
    if (header) observer.observe(header)
    window.addEventListener("resize", place)
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("resize", place)
    })
  })
  const close = () => {
    setPrefs("open", false)
    setAnchor("forced", false)
    button?.focus()
  }
  const toggle = () => {
    if (shown()) return close()
    setPrefs("open", true)
    if (anchor.squeezed) setAnchor("forced", true)
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={shown()}
        aria-controls="thread-environment"
        class="hidden md:flex h-7 items-center gap-1 rounded-full px-2.5 type-control text-v2-text-text-muted outline-none transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base aria-expanded:bg-v2-overlay-simple-overlay-pressed aria-expanded:text-v2-text-text-base focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
        onClick={toggle}
      >
        {language.t("secondBrain.environment.title")}
        <Icon
          name="chevron-down"
          size="small"
          class="shrink-0 transition-transform duration-short ease-standard motion-reduce:transition-none"
          classList={{ "rotate-180": shown() }}
        />
      </button>
      <Portal>
        {/* The anchor is positioned and the animated wrapper inside it is not: an animated transform makes its box
            the containing block of any fixed child. */}
        <div
          class="fixed z-40 hidden md:block"
          style={{ top: `${anchor.top}px`, right: `${anchor.right}px`, width: `${anchor.width}px` }}
        >
          <Presence
            when={shown()}
            enterClass="animate-menu-enter"
            exitClass="animate-menu-exit"
            class="origin-top-right"
          >
            <aside
              id="thread-environment"
              aria-label={language.t("secondBrain.environment.title")}
              class="flex w-full flex-col overflow-hidden rounded-[24px] bg-v2-background-bg-floating shadow-[inset_0_0_0_1px_var(--v2-border-border-muted),var(--v2-elevation-floating)]"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return
                event.stopPropagation()
                close()
              }}
            >
              <EnvironmentSections harness={props.harness} onClose={close} />
            </aside>
          </Presence>
        </div>
      </Portal>
    </>
  )
}

/**
 * The window's body, laid out as the workshop's variant A: one card of sections split by hairlines, each with a
 * sentence-case title, a label column for where the thread runs, a thin context bar with its legend, and
 * single-line rows for connectors, changes and what is running.
 */
function EnvironmentSections(props: { harness?: ThreadHarness; onClose: () => void }) {
  const context = createComposerContext()
  const subagents = useThreadSubagents(() => true)
  return (
    // The scrolling body is a tab stop, so the keyboard can scroll it.
    <div
      data-component="thread-environment"
      tabIndex={0}
      aria-label={useLanguage().t("secondBrain.environment.title")}
      class="flex max-h-[min(640px,calc(100vh-280px))] flex-col divide-y divide-v2-border-border-muted overflow-y-auto outline-none text-[12px] leading-[16px] [font-weight:400] tabular-nums text-v2-text-text-base"
    >
      <WhereSection harness={props.harness} model={context.context()?.modelLabel} onClose={props.onClose} />
      <ContextSection context={context} harness={props.harness} />
      <ConnectorsSection harness={props.harness} />
      <ChangesSection />
      <RunningSection groups={subagents()} />
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
function WhereSection(props: { harness?: ThreadHarness; model?: string; onClose: () => void }) {
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
    <section class="flex flex-col gap-2.5 pb-3.5 pl-[18px] pr-2.5 pt-2.5">
      <div class="flex h-7 items-center gap-2">
        <h2 class="m-0 flex-1 text-[13px] leading-[18px] [font-weight:600]">
          {language.t("secondBrain.environment.title")}
        </h2>
        <IconButtonV2
          icon={<Icon name="xmark-small" size="small" />}
          size="small"
          variant="ghost-muted"
          aria-label={language.t("common.close")}
          onClick={() => props.onClose()}
        />
      </div>
      <dl class="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 pr-2">
        <dt class="text-v2-text-text-muted">{language.t("secondBrain.environment.harness")}</dt>
        <dd class="m-0 min-w-0 truncate">
          {[currentHarness(props.harness)?.name, props.model].filter(Boolean).join(" · ")}
        </dd>
        <dt class="text-v2-text-text-muted">{language.t("secondBrain.environment.folder")}</dt>
        <dd class="m-0 min-w-0">
          <PathTooltip
            placement="left"
            class="min-w-0"
            name={language.t("secondBrain.environment.folder")}
            path={directory()}
          >
            {/* Cut from the start, so the folder's own name stays visible. */}
            <span class="block min-w-0 truncate text-left font-mono text-[11.5px] [direction:rtl]">
              <bdi>{shortFolder(directory(), serverSync().data.path?.home)}</bdi>
            </span>
          </PathTooltip>
        </dd>
        <dt class="text-v2-text-text-muted">{language.t("secondBrain.environment.branch")}</dt>
        <dd class="m-0 min-w-0 truncate font-mono text-[11.5px]">
          {branch() ?? language.t("secondBrain.environment.noBranch")}
        </dd>
        <dt class="text-v2-text-text-muted">{language.t("secondBrain.environment.approvals")}</dt>
        <dd class="m-0 min-w-0 truncate">
          {language.t(`secondBrain.permissionMode.${mode()}` as Parameters<typeof language.t>[0])}
        </dd>
      </dl>
    </section>
  )
}

// One step of the accent or grey per kind, so the parts differ in lightness as well as hue.
const SHADE: Record<ContextPartKey, string> = {
  messages: "bg-v2-icon-icon-accent",
  tools: "bg-v2-icon-icon-accent/55",
  system: "bg-v2-text-text-muted",
  other: "bg-v2-border-border-strong",
  free: "bg-transparent",
}

/**
 * How full the context window is and what fills it. Every harness reports the total; what is in it is estimated
 * from the thread's own text (about four characters a token). For Codex, Claude Code and the other agents, what
 * the thread's text doesn't explain is the agent's own instructions and tool definitions, which Tenon can't see.
 */
function ContextSection(props: { context: ReturnType<typeof createComposerContext>; harness?: ThreadHarness }) {
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
        <Section title={language.t("secondBrain.environment.context")}>
          <Show
            when={!value().compacted && value().reported && value().limit ? value() : undefined}
            fallback={
              <p class="m-0 text-v2-text-text-muted">
                {value().compacted
                  ? language.t("secondBrain.contextMenu.compacted")
                  : value().reported
                    ? language.t("secondBrain.contextMenu.usedTokens", { count: formatter().number(value().total) })
                    : language.t("secondBrain.contextMenu.notReported")}
              </p>
            }
          >
            {(reported) => (
              <>
                <div class="flex items-baseline gap-2">
                  <span class="flex-1 text-[14px] leading-[18px] [font-weight:600]">
                    {language.t("secondBrain.contextStrip.usage.used", {
                      percent: formatter().percent(reported().usage ?? 0),
                    })}
                  </span>
                  <span class="text-v2-text-text-muted">
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
                <div class="flex flex-col gap-1.5">
                  <For each={parts()}>
                    {(part) => (
                      <div class="flex items-center gap-2">
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
                        <span class="w-11 text-right" classList={{ "text-v2-text-text-muted": part.key === "free" }}>
                          {`${Math.round(part.percent)}%`}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
                <p class="m-0 text-v2-text-text-muted">
                  {language.t(
                    external()
                      ? "secondBrain.environment.breakdown.estimatedExternal"
                      : "secondBrain.environment.breakdown.estimated",
                  )}
                </p>
              </>
            )}
          </Show>
        </Section>
      )}
    </Show>
  )
}

/**
 * The MCP servers the thread's agent can use: the user's from Settings, on or off, and for Codex and the ACP agents
 * Tenon's own server. Whether an external agent connected each one isn't reported, so only on and off are shown.
 * The title opens the MCP settings.
 */
function ConnectorsSection(props: { harness?: ThreadHarness }) {
  const language = useLanguage()
  const serverSync = useServerSync()
  const dialog = useDialog()
  const rows = createMemo(() =>
    connectorRows(serverSync().data.config.mcp as Parameters<typeof connectorRows>[0], isExternal(props.harness)),
  )
  return (
    <section class="flex flex-col gap-2 px-[18px] py-3.5">
      <SectionLink
        title={language.t("secondBrain.environment.connectors")}
        label={language.t("secondBrain.environment.manage")}
        onClick={() => void dialog.show(() => <DialogSettings defaultValue="mcp" />)}
      >
        <span class="text-v2-text-text-muted">
          {language.t("secondBrain.environment.connectorsOn", { count: rows().filter((row) => row.on).length })}
        </span>
      </SectionLink>
      <Show
        when={rows().length > 0}
        fallback={<p class="m-0 text-v2-text-text-muted">{language.t("secondBrain.environment.noConnectors")}</p>}
      >
        <div class="flex flex-col gap-1.5">
          <For each={rows()}>
            {(row) => (
              <div class="flex items-center gap-2">
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  classList={{ "bg-v2-state-fg-success": row.on, "bg-v2-border-border-strong": !row.on }}
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate">
                  {row.builtIn ? language.t("secondBrain.environment.tenonTools") : row.name}
                </span>
                <span class="text-v2-text-text-muted">
                  {language.t(row.on ? "secondBrain.environment.on" : "secondBrain.environment.off")}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

/** The thread's file changes in one line; with changes, the line opens the review panel. */
function ChangesSection() {
  const language = useLanguage()
  const sync = useSync()
  const { params, view, tabs } = useSessionLayout()
  const totals = createMemo(() => changeTotals(params.id ? sync().data.session_diff[params.id] : undefined))
  return (
    <section class="px-[18px] py-3.5">
      <Show
        when={totals().files > 0}
        fallback={
          <div class="flex items-center gap-2">
            <h3 class="m-0 flex-1 text-[13px] leading-[18px] [font-weight:600]">
              {language.t("secondBrain.environment.changes")}
            </h3>
            <span class="text-v2-text-text-muted">{language.t("secondBrain.environment.noChanges")}</span>
          </div>
        }
      >
        <SectionLink
          title={language.t("secondBrain.environment.changes")}
          label={language.t("secondBrain.environment.review")}
          onClick={() => {
            view().reviewPanel.open("other")
            void tabs().open("review")
            tabs().setActive("review")
          }}
        >
          <span class="font-mono">
            <Show when={totals().additions > 0}>
              <span class="text-v2-state-fg-success">{`+${totals().additions}`}</span>
            </Show>
            <Show when={totals().additions > 0 && totals().deletions > 0}> </Show>
            <Show when={totals().deletions > 0}>
              <span class="text-v2-state-fg-danger">{`−${totals().deletions}`}</span>
            </Show>
          </span>
          <span class="text-v2-text-text-muted">
            {language.t("secondBrain.environment.files", { count: totals().files })}
          </span>
        </SectionLink>
      </Show>
    </section>
  )
}

/** What the thread has running now: its subagents and the open terminals. */
function RunningSection(props: { groups: Parameters<typeof runningSubagents>[0] }) {
  const language = useLanguage()
  const terminal = useTerminal()
  return (
    <Section title={language.t("secondBrain.environment.running")} last>
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            class="shrink-0 text-v2-icon-icon-muted"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="M7 4.5V7l1.5 1" />
          </svg>
          <span class="min-w-0 flex-1 truncate">{language.t("secondBrain.environment.subagents")}</span>
          <span class="text-v2-text-text-muted">{runningSubagents(props.groups)}</span>
        </div>
        <div class="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            class="shrink-0 text-v2-icon-icon-muted"
            aria-hidden="true"
          >
            <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
            <path d="M4 6l2 1.5L4 9" />
          </svg>
          <span class="min-w-0 flex-1 truncate">{language.t("secondBrain.environment.terminals")}</span>
          <span class="text-v2-text-text-muted">{terminal.all().length}</span>
        </div>
      </div>
    </Section>
  )
}

/** A section of the card: a sentence-case title over its content. */
function Section(props: { title: string; last?: boolean; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-2.5 px-[18px] pt-3.5" classList={{ "pb-3.5": !props.last, "pb-4": props.last }}>
      <h3 class="m-0 text-[13px] leading-[18px] [font-weight:600]">{props.title}</h3>
      {props.children}
    </section>
  )
}

/** A section title that opens something: the title, a summary on the right and a chevron. */
function SectionLink(props: { title: string; label: string; onClick: () => void; children: JSX.Element }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      class="-mx-2 flex items-center gap-2 rounded-[8px] px-2 py-0.5 text-left outline-none transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
      onClick={() => props.onClick()}
    >
      <span class="flex-1 text-[13px] leading-[18px] [font-weight:600]">{props.title}</span>
      {props.children}
      <Icon name="chevron-down" size="small" class="shrink-0 -rotate-90 text-v2-icon-icon-muted" />
    </button>
  )
}
