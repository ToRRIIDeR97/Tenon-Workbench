import { For, Match, Show, Switch, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import { Icon as StepIcon } from "@tenon/ui/icon"
import { stepIcon, stepVerbKey, subagentName, toolStep } from "@tenon/session-ui/step-kind"
import { ScrollView } from "@tenon/ui/scroll-view"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { IconButtonV2 } from "@tenon/ui/v2/icon-button-v2"
import { TooltipV2 } from "@tenon/ui/v2/tooltip-v2"
import { ViewSwitch } from "@tenon/ui/v2/view-switch"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { useSessionLayout } from "@/pages/session/session-layout"
import {
  commandExit,
  commandOutput,
  commandTitle,
  findTask,
  isTerminalTask,
  lastOutputLine,
  stopTarget,
  taskCounts,
  taskElapsed,
  taskSections,
  taskStatus,
  terminalID,
  threadBackgroundTasks,
  type BackgroundTask,
  type TaskFilter,
} from "./background-tasks"
import { createSessionContextFormatter } from "./session-context-format"
import { childLaneSteps, laneTokens, subagentLane, taskSessionID } from "./subagent-lane"
import { AgentDetail, BackLink, Missing, useNow } from "./subagent-tab"
import { formatTurnDuration } from "./turn-steps-summary"

export function useThreadTasks(enabled: () => boolean) {
  const sync = useSync()
  const { params } = useSessionLayout()
  return createMemo(() => {
    const sessionID = params.id
    if (!sessionID || !enabled()) return [] as BackgroundTask[]
    return threadBackgroundTasks(sync().data.message[sessionID] ?? [], (id) => sync().data.part[id])
  })
}

export function useLiveTerminals() {
  const terminal = useTerminal()
  return createMemo(() => new Set(terminal.all().map((tab) => tab.id)))
}

function useStop() {
  const sdk = useSDK()
  const language = useLanguage()
  const terminal = useTerminal()
  const live = useLiveTerminals()
  const { params } = useSessionLayout()
  const target = (task: BackgroundTask) => stopTarget(task, params.id, live())
  return {
    target,
    label: (task: BackgroundTask) =>
      language.t(
        target(task)?.scope === "turn" ? "secondBrain.backgroundTasks.stopTurn" : "secondBrain.backgroundTasks.stop",
      ),
    run: (task: BackgroundTask) => {
      const found = target(task)
      if (!found) return
      if (found.scope === "terminal") return void terminal.close(found.terminalID).catch(() => {})
      void sdk()
        .api.session.interrupt({ sessionID: found.sessionID })
        .catch(() => {})
    },
  }
}

function useTaskText() {
  const language = useLanguage()
  const live = useLiveTerminals()
  const title = (task: BackgroundTask) => {
    if (task.kind === "command")
      return commandTitle(task.part) ?? language.t("secondBrain.backgroundTasks.commandFallback")
    const named = subagentName(task.part.state.input)
    return named.name ?? named.tag ?? language.t("secondBrain.agentTab.agentFallback")
  }
  const duration = (part: ToolPart, now: number) => formatTurnDuration(language, taskElapsed(part, now, live()))
  const outcome = (task: BackgroundTask, now: number, tokens?: string) => {
    const status = taskStatus(task.part, live())
    const exit = task.kind === "command" ? commandExit(task.part) : undefined
    return [
      language.t(`secondBrain.backgroundTasks.status.${status === "running" ? "done" : status}`),
      duration(task.part, now),
      exit === undefined ? undefined : language.t("secondBrain.backgroundTasks.exit", { code: exit }),
      status === "failed" ? undefined : tokens,
    ]
      .filter((value) => value !== undefined)
      .join(" · ")
  }
  return { title, duration, outcome }
}

export function BackgroundTasksTab(props: {
  tasks: BackgroundTask[]
  selected?: string
  onSelect: (partID: string | undefined) => void
  harnessName?: (id: string) => string | undefined
}) {
  const stop = useStop()
  const selected = createMemo(() => findTask(props.tasks, props.selected))
  const back = () => props.onSelect(undefined)
  return (
    <ViewSwitch class="h-full" key={props.selected ?? "list"}>
      <Show when={props.selected} fallback={<TaskList tasks={props.tasks} onSelect={(id) => props.onSelect(id)} />}>
        <Show when={selected()} fallback={<Missing onBack={back} />}>
          {(task) => (
            <Show when={task().kind === "agent"} fallback={<CommandDetail task={task()} onBack={back} />}>
              <AgentDetail
                item={task()}
                onBack={back}
                harnessName={props.harnessName}
                actions={
                  <Show when={stop.target(task())}>
                    <ButtonV2
                      size="small"
                      variant="outline"
                      class="gap-1.5"
                      data-action="task-stop"
                      onClick={() => stop.run(task())}
                    >
                      <Icon name="stop" size="small" />
                      <span>{stop.label(task())}</span>
                    </ButtonV2>
                  </Show>
                }
              />
            </Show>
          )}
        </Show>
      </Show>
    </ViewSwitch>
  )
}

function TaskList(props: { tasks: BackgroundTask[]; onSelect: (partID: string) => void }) {
  const language = useLanguage()
  const [state, setState] = createStore<{ filter: TaskFilter }>({ filter: "all" })
  const live = useLiveTerminals()
  const counts = createMemo(() => taskCounts(props.tasks, live()))
  const now = useNow(() => counts().running > 0)
  const sections = createMemo(() => taskSections(props.tasks, state.filter, live()))
  const ids = (list: BackgroundTask[]) => list.map((task) => task.part.id)
  const running = createMemo(() => ids(sections().running), undefined, { equals: sameList })
  const finished = createMemo(() => ids(sections().finished), undefined, { equals: sameList })
  const filters: TaskFilter[] = ["all", "agent", "command"]
  const rows = (list: () => string[]) => (
    <div class="flex flex-col rounded-[16px] bg-v2-background-bg-layer-01 p-1">
      <For each={list()}>
        {(id) => (
          <Show when={findTask(props.tasks, id)}>
            {(task) => <TaskRow task={task()} now={now()} onOpen={() => props.onSelect(id)} />}
          </Show>
        )}
      </For>
    </div>
  )
  const heading = (label: string, count: number) => (
    <div class="flex min-w-0 items-center gap-1.5 px-1 text-[12px] leading-4 text-v2-text-text-muted">
      <span class="shrink-0 [font-weight:500]">{label}</span>
      <span aria-hidden="true">·</span>
      <span class="tabular-nums">{count.toLocaleString(language.intl())}</span>
    </div>
  )

  return (
    <ScrollView class="@container h-full">
      <div data-slot="tasks-list" class="flex flex-col gap-4 px-4 pt-2 pb-10">
        <Show
          when={counts().all > 0}
          fallback={
            <div class="px-1 text-[13px] leading-5 text-v2-text-text-muted">
              {language.t("secondBrain.backgroundTasks.empty")}
            </div>
          }
        >
          <div
            role="radiogroup"
            aria-label={language.t("secondBrain.backgroundTasks.filter.label")}
            class="flex flex-wrap gap-1.5"
          >
            <For each={filters}>
              {(filter) => (
                <button
                  type="button"
                  role="radio"
                  data-slot="tasks-filter"
                  aria-checked={state.filter === filter}
                  class="flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] leading-4 transition-colors duration-short ease-standard motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
                  classList={{
                    "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container":
                      state.filter === filter,
                    "bg-v2-background-bg-layer-01 text-v2-text-text-base hover:bg-v2-background-bg-layer-02":
                      state.filter !== filter,
                  }}
                  onClick={() => setState("filter", filter)}
                >
                  <span>{language.t(`secondBrain.backgroundTasks.filter.${filter}`)}</span>
                  <span class="tabular-nums opacity-70">{counts()[filter].toLocaleString(language.intl())}</span>
                </button>
              )}
            </For>
          </div>
          <section data-slot="tasks-section" data-section="running" class="flex flex-col gap-2">
            {heading(language.t("secondBrain.backgroundTasks.running"), running().length)}
            <Show
              when={running().length > 0}
              fallback={
                <div class="px-1 text-[13px] leading-5 text-v2-text-text-muted">
                  {language.t("secondBrain.backgroundTasks.nothingRunning")}
                </div>
              }
            >
              {rows(running)}
            </Show>
          </section>
          <Show when={finished().length > 0}>
            <section data-slot="tasks-section" data-section="finished" class="flex flex-col gap-2">
              {heading(language.t("secondBrain.backgroundTasks.finished"), finished().length)}
              {rows(finished)}
            </section>
          </Show>
        </Show>
      </div>
    </ScrollView>
  )
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function RunningDot() {
  const language = useLanguage()
  return (
    <span
      role="img"
      aria-label={language.t("secondBrain.agentTab.status.running")}
      class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse"
    />
  )
}

function TaskRow(props: { task: BackgroundTask; now: number; onOpen: () => void }) {
  const language = useLanguage()
  const sync = useSync()
  const text = useTaskText()
  const stop = useStop()
  const live = useLiveTerminals()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const part = () => props.task.part
  const status = createMemo(() => taskStatus(part(), live()))
  const inTerminal = () => !!terminalID(part())
  const tag = () => (props.task.kind === "agent" ? subagentName(part().state.input) : undefined)
  const step = createMemo(() => {
    if (props.task.kind !== "agent" || status() !== "running") return undefined
    const current = subagentLane(part(), (item) => {
      const id = taskSessionID(item)
      if (!id) return undefined
      return childLaneSteps((sync().data.message[id] ?? []).flatMap((message) => sync().data.part[message.id] ?? []))
    }).current
    if (!current) return undefined
    const described = toolStep(current.tool, { title: current.title })
    return {
      icon: stepIcon(described.kind),
      verb: language.t(stepVerbKey(described.kind, current.status === "pending" || current.status === "in_progress")),
      target: described.target,
    }
  })
  const line = createMemo(() =>
    props.task.kind === "command" && status() === "running" && !inTerminal()
      ? lastOutputLine(commandOutput(part()))
      : undefined,
  )
  const tokens = () => {
    if (props.task.kind !== "agent") return undefined
    const id = taskSessionID(part())
    const count = laneTokens(part(), id ? sync().session.get(id) : undefined)
    return count === undefined
      ? undefined
      : language.t("secondBrain.agents.tokens", { count: formatter().number(count) })
  }
  const error = () => {
    const state = part().state
    return status() === "failed" && state.status === "error" ? state.error : undefined
  }

  return (
    <div
      data-slot="task-row"
      data-kind={props.task.kind}
      data-status={status()}
      class="animate-enter flex min-w-0 items-start rounded-[12px] text-[13px] leading-5 text-v2-text-text-base transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none"
    >
      <button
        type="button"
        data-action="task-open"
        class="flex min-w-0 flex-1 gap-2.5 rounded-[12px] px-2 py-2 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
        onClick={() => props.onOpen()}
      >
        <span class="flex h-5 w-4 shrink-0 items-center text-v2-icon-icon-muted">
          <StepIcon name={stepIcon(props.task.kind === "agent" ? "subagent" : "run")} size="small" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="flex min-w-0 items-center gap-2">
            <span
              class="min-w-0 truncate [font-weight:500]"
              classList={{ "font-mono text-[12px]": props.task.kind === "command" }}
            >
              {text.title(props.task)}
            </span>
            <Show when={tag()?.name && tag()?.tag}>
              {(value) => (
                <span class="shrink-0 rounded-full bg-v2-background-bg-base px-1.5 text-[11px] leading-4 text-v2-text-text-muted">
                  {value()}
                </span>
              )}
            </Show>
            <span class="flex-1" />
            <Show when={status() === "running"}>
              <RunningDot />
              <span class="shrink-0 tabular-nums text-[12px] leading-4 text-v2-text-text-muted">
                {text.duration(part(), props.now)}
              </span>
            </Show>
          </span>
          <span
            data-slot="task-row-status"
            class="flex h-4 min-w-0 items-center gap-1.5 text-[12px] leading-4"
            classList={{
              "text-v2-text-text-critical": status() === "failed",
              "text-v2-text-text-muted": status() !== "failed",
            }}
          >
            <Switch
              fallback={<span class="min-w-0 truncate">{language.t("secondBrain.backgroundTasks.starting")}</span>}
            >
              <Match when={status() !== "running"}>
                <span class="shrink-0">{text.outcome(props.task, props.now, tokens())}</span>
                <Show when={error()}>
                  {(message) => (
                    <>
                      <span aria-hidden="true">·</span>
                      <span class="min-w-0 truncate">{message()}</span>
                    </>
                  )}
                </Show>
              </Match>
              <Match when={inTerminal()}>
                <span class="min-w-0 truncate">{language.t("secondBrain.backgroundTasks.inTerminal")}</span>
              </Match>
              <Match when={line()}>{(value) => <span class="min-w-0 truncate font-mono">{value()}</span>}</Match>
              <Match when={step()}>
                {(value) => (
                  <>
                    <StepIcon name={value().icon} size="small" class="shrink-0" />
                    <span class="shrink-0">{value().verb}</span>
                    <Show when={value().target}>
                      {(target) => <span class="min-w-0 truncate font-mono">{target()}</span>}
                    </Show>
                  </>
                )}
              </Match>
            </Switch>
          </span>
        </span>
      </button>
      <Show when={stop.target(props.task)}>
        <TooltipV2 placement="left" value={stop.label(props.task)}>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="small"
            data-action="task-stop"
            class="mt-1.5 me-1.5 shrink-0"
            icon={<Icon name="stop" />}
            aria-label={language.t("secondBrain.backgroundTasks.stopNamed", {
              action: stop.label(props.task),
              name: text.title(props.task),
            })}
            onClick={() => stop.run(props.task)}
          />
        </TooltipV2>
      </Show>
    </div>
  )
}

function CommandDetail(props: { task: BackgroundTask; onBack: () => void }) {
  const language = useLanguage()
  const text = useTaskText()
  const stop = useStop()
  const terminal = useTerminal()
  const live = useLiveTerminals()
  const { view } = useSessionLayout()
  const part = () => props.task.part
  const status = createMemo(() => taskStatus(part(), live()))
  const now = useNow(() => status() === "running")
  const showTerminal = () => {
    const id = terminalID(part())
    if (!id) return
    view().terminal.open()
    terminal.open(id)
  }
  const output = createMemo(() => commandOutput(part()))
  const [state, setState] = createStore({ copied: false, follow: true })
  let box: HTMLPreElement | undefined
  createEffect(() => {
    output()
    if (box && state.follow) box.scrollTop = box.scrollHeight
  })
  const copy = () =>
    void navigator.clipboard
      .writeText(output())
      .then(() => {
        setState("copied", true)
        setTimeout(() => setState("copied", false), 2000)
      })
      .catch(() => {})

  return (
    <ScrollView class="@container h-full">
      <div data-slot="task-detail" class="flex flex-col gap-4 px-4 pt-2 pb-10">
        <BackLink onBack={props.onBack} action="tasks-back" />
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex min-w-0 items-start gap-2">
            <span class="flex h-5 w-4 shrink-0 items-center text-v2-icon-icon-muted">
              <StepIcon name={stepIcon("run")} size="small" />
            </span>
            <span class="min-w-0 break-words font-mono text-[13px] leading-5 text-v2-text-text-base [font-weight:600]">
              {text.title(props.task)}
            </span>
          </div>
          <div
            class="flex min-w-0 items-center gap-1.5 text-[12px] leading-4"
            classList={{
              "text-v2-text-text-critical": status() === "failed",
              "text-v2-text-text-muted": status() !== "failed",
            }}
          >
            <Show when={status() === "running"} fallback={<span>{text.outcome(props.task, now())}</span>}>
              <RunningDot />
              <span>{language.t("secondBrain.agentTab.status.running")}</span>
              <span aria-hidden="true">·</span>
              <span class="tabular-nums">{text.duration(part(), now())}</span>
            </Show>
          </div>
        </div>

        <Show
          when={!isTerminalTask(part())}
          fallback={
            <div data-slot="task-terminal-note" class="text-[13px] leading-5 text-v2-text-text-muted">
              {language.t(
                status() === "running"
                  ? "secondBrain.backgroundTasks.outputInTerminal"
                  : "secondBrain.backgroundTasks.terminalClosed",
              )}
            </div>
          }
        >
          <div class="flex flex-col gap-1">
            <div class="text-[11px] leading-4 text-v2-text-text-muted">
              {language.t("secondBrain.backgroundTasks.output")}
            </div>
            <Show
              when={output().trim()}
              fallback={
                <div class="text-[13px] leading-5 text-v2-text-text-muted">
                  {language.t(
                    status() === "running"
                      ? "secondBrain.backgroundTasks.noOutputYet"
                      : "secondBrain.backgroundTasks.noOutput",
                  )}
                </div>
              }
            >
              <pre
                ref={box}
                data-slot="task-output"
                tabIndex={0}
                class="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2.5 font-mono text-[12px] leading-[18px] text-v2-text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
                onScroll={(event) =>
                  setState(
                    "follow",
                    event.currentTarget.scrollHeight -
                      event.currentTarget.scrollTop -
                      event.currentTarget.clientHeight <
                      24,
                  )
                }
              >
                {output()}
              </pre>
            </Show>
          </div>
        </Show>

        <div class="flex min-w-0 flex-wrap items-center justify-end gap-1.5 border-t border-v2-border-border-muted pt-3">
          <Show when={status() === "running" && terminalID(part())}>
            <ButtonV2 size="small" variant="ghost" data-action="task-show-terminal" onClick={showTerminal}>
              {language.t("secondBrain.backgroundTasks.showTerminal")}
            </ButtonV2>
          </Show>
          <Show when={!isTerminalTask(part()) && output().trim()}>
            <ButtonV2 size="small" variant="ghost" data-action="task-copy-output" onClick={copy}>
              {language.t(
                state.copied ? "secondBrain.backgroundTasks.copied" : "secondBrain.backgroundTasks.copyOutput",
              )}
            </ButtonV2>
          </Show>
          <Show when={stop.target(props.task)}>
            <ButtonV2
              size="small"
              variant="outline"
              class="gap-1.5"
              data-action="task-stop"
              onClick={() => stop.run(props.task)}
            >
              <Icon name="stop" size="small" />
              <span>{stop.label(props.task)}</span>
            </ButtonV2>
          </Show>
        </div>
      </div>
    </ScrollView>
  )
}
