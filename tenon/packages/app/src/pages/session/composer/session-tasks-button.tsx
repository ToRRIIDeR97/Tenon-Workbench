import { For, Show, createMemo, createResource, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Popover } from "@tenon/ui/popover"
import { Icon } from "@tenon/ui/v2/icon"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useTerminal } from "@/context/terminal"
import { SubagentLane, subagentLane } from "@/components/session/subagent-lane"
import { subagentCounts, type SubagentGroup } from "@/components/session/subagent-list"
import { listRoutines } from "@/features/second-brain/client"
import { AGENTS_TAB, selectAgent } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { formatTurnDuration } from "@/components/session/turn-steps-summary"

/**
 * The composer's Tasks button: how many subagents are running, and a panel of everything working in the
 * background for this thread: subagents, open terminals and the workspace's next routines. A subagent opens in
 * the Agents tab; a terminal opens the terminal panel.
 */
export function SessionTasksButton(props: { groups: () => SubagentGroup[] }) {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const terminal = useTerminal()
  const session = useSessionLayout()
  const [state, setState] = createStore({ open: false })
  const counts = createMemo(() => subagentCounts(props.groups()))
  const running = createMemo(() =>
    props
      .groups()
      .flatMap((group) => group.items)
      .filter((item) => item.part.state.status === "pending" || item.part.state.status === "running"),
  )
  const finished = () => counts().all - counts().running
  const terminals = () => terminal.all()
  const total = () => counts().running + terminals().length

  const [now, setNow] = createSignal(Date.now())
  // Ticks only while the panel is open, for the lanes' elapsed times.
  const timer = setInterval(() => state.open && setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  const [routines] = createResource(
    () => (state.open ? layout.home.workspace() : undefined),
    (directory) =>
      listRoutines({ server: serverSDK().server, fetch: platform.fetch, target: { directory } }).then((list) =>
        list
          .filter((routine) => routine.enabled && routine.nextRun)
          .toSorted((a, b) => Date.parse(a.nextRun!) - Date.parse(b.nextRun!))
          .slice(0, 3),
      ),
  )

  const openAgent = (partID?: string) => {
    const view = session.view()
    const tabs = session.tabs()
    selectAgent(session.sessionKey(), partID)
    view.reviewPanel.open(view.reviewPanel.opened() ? "other" : "context-button")
    if (!tabs.all().includes(AGENTS_TAB)) tabs.setAll([...tabs.all(), AGENTS_TAB])
    tabs.setActive(AGENTS_TAB)
    setState("open", false)
  }
  const openTerminal = () => {
    session.view().terminal.open()
    setState("open", false)
  }
  const time = (value: string) =>
    new Intl.DateTimeFormat(language.intl(), { weekday: "short", hour: "numeric", minute: "2-digit" }).format(
      new Date(value),
    )

  return (
    <Show when={total() > 0 || counts().all > 0}>
      <TooltipV2 placement="top" value={language.t("secondBrain.backgroundTasks.title")}>
        <Popover
          open={state.open}
          onOpenChange={(open) => setState("open", open)}
          placement="top-end"
          gutter={8}
          class="w-[min(400px,calc(100vw-32px))] [&_[data-slot=popover-body]]:p-2"
          triggerAs="button"
          triggerProps={{
            type: "button",
            ...TASKS_ACTION,
            "aria-label": language.t("secondBrain.backgroundTasks.button", { count: total() }),
            class:
              "flex h-8 items-center gap-1.5 rounded-full px-3 type-control text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base data-[expanded]:bg-v2-background-bg-accent-container data-[expanded]:text-v2-text-text-on-accent-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none",
          }}
          trigger={
            <>
              <Icon name="activity" size="small" class="shrink-0" />
              <span>{language.t("secondBrain.backgroundTasks.title")}</span>
              <Show when={total() > 0}>
                <span class="tabular-nums">{total()}</span>
              </Show>
            </>
          }
        >
          <div
            data-component="tasks-panel"
            class="flex max-h-[min(520px,70vh)] flex-col gap-3 overflow-y-auto text-[13px]"
          >
            <Section title={language.t("secondBrain.backgroundTasks.subagents")}>
              <Show when={running().length > 0} fallback={<Empty text={language.t("secondBrain.backgroundTasks.noSubagents")} />}>
                <For each={running()}>
                  {(item) => (
                    <div class="rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2">
                      <SubagentLane
                        lane={subagentLane(item.part)}
                        now={now()}
                        formatDuration={(ms) => formatTurnDuration(language, ms)}
                        onOpen={() => openAgent(item.part.id)}
                      />
                    </div>
                  )}
                </For>
              </Show>
            </Section>

            <Section title={language.t("secondBrain.backgroundTasks.terminals")}>
              <Show
                when={terminals().length > 0}
                fallback={<Empty text={language.t("secondBrain.backgroundTasks.noTerminals")} />}
              >
                <For each={terminals()}>
                  {(pty) => (
                    <button
                      type="button"
                      class="flex h-9 w-full items-center gap-2 rounded-[12px] px-3 text-left hover:bg-v2-overlay-simple-overlay-hover"
                      onClick={openTerminal}
                    >
                      <Icon name="terminal" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                      <span class="min-w-0 truncate">{pty.title}</span>
                    </button>
                  )}
                </For>
              </Show>
            </Section>

            <Section title={language.t("secondBrain.backgroundTasks.routines")}>
              <Show
                when={(routines.latest?.length ?? 0) > 0}
                fallback={<Empty text={language.t("secondBrain.backgroundTasks.noRoutines")} />}
              >
                <For each={routines.latest ?? []}>
                  {(routine) => (
                    <div class="flex h-9 items-center gap-2 px-3">
                      <span class="min-w-0 flex-1 truncate">{routine.name}</span>
                      <span class="shrink-0 text-[12px] text-v2-text-text-muted">{time(routine.nextRun!)}</span>
                    </div>
                  )}
                </For>
              </Show>
            </Section>

            <Show when={finished() > 0 || counts().all > 0}>
              <button
                type="button"
                class="flex h-9 w-full items-center justify-between rounded-full bg-v2-background-bg-layer-01 px-3 text-left hover:bg-v2-background-bg-layer-02"
                onClick={() => openAgent()}
              >
                <span>{language.t("secondBrain.backgroundTasks.allAgents", { count: finished() })}</span>
                <Icon name="chevron-right" size="small" class="shrink-0 text-v2-icon-icon-muted" />
              </button>
            </Show>
          </div>
        </Popover>
      </TooltipV2>
    </Show>
  )
}

const TASKS_ACTION = { "data-action": "tasks" }

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-1">
      <span class="px-1 text-[11px] uppercase tracking-[0.04em] text-v2-text-text-muted [font-weight:560]">
        {props.title}
      </span>
      {props.children}
    </section>
  )
}

function Empty(props: { text: string }) {
  return <span class="px-1 py-1 text-[12px] text-v2-text-text-muted">{props.text}</span>
}
