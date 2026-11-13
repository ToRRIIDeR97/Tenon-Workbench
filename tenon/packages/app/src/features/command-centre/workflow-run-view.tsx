import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Meter } from "@/components/meter"
import type { SidebarController } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { useWorkflows, type WorkflowRun } from "@/features/command-centre/workflow-store"
import { sessionTitle } from "@/utils/session-title"

const cardClass =
  "flex min-w-0 flex-col gap-1.5 rounded-[16px] bg-v2-background-bg-base px-4 py-3 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
const chipClass = "flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 type-caption"

/** The highest round the run has reported, 0 before its first report. */
export const currentRound = (run: WorkflowRun) => run.rounds.reduce((most, round) => Math.max(most, round.n), 0)

/** The approved round, for a finished run. */
const approvedRound = (run: WorkflowRun) => run.rounds.find((round) => round.outcome === "approved")?.n ?? 0

/** Newest first. */
export const newestRuns = (runs: ReadonlyArray<WorkflowRun>) =>
  runs.toSorted((left, right) => right.startedAt - left.startedAt)

/** The words of a run's status; the running one carries the round. */
export function useRunStatusText() {
  const language = useLanguage()
  return (run: WorkflowRun) => {
    if (run.status === "running" && currentRound(run) === 0) return language.t("secondBrain.run.status.starting")
    return language.t(`secondBrain.run.status.${run.status}`, {
      round: run.status === "done" ? approvedRound(run) : currentRound(run),
      max: run.maxRounds,
    })
  }
}

/**
 * The Workflows view's list of runs, newest first: what each is (workflow and Project) and how it stands. A run
 * opens in the run view.
 */
export function WorkflowRunList(props: { ctrl: SidebarController; selected?: string; select: (id: string) => void }) {
  const language = useLanguage()
  const store = useWorkflows()
  const runs = createMemo(() => newestRuns(store.runs()).map((run) => run.id))
  return (
    <div class="flex flex-col gap-1">
      <h3 class="px-1 type-section text-v2-text-text-base">{language.t("secondBrain.workflows.runs")}</h3>
      <Show
        when={runs().length > 0}
        fallback={
          <p class="px-1 type-meta text-v2-text-text-muted">{language.t("secondBrain.workflows.runs.empty")}</p>
        }
      >
        <ul
          data-component="workflow-runs"
          class="flex flex-col gap-0.5"
          aria-label={language.t("secondBrain.workflows.runs.list")}
        >
          <For each={runs()}>
            {(id) => (
              <Show when={store.runs().find((run) => run.id === id)}>
                {(run) => (
                  <li>
                    <button
                      type="button"
                      data-run={run().id}
                      data-status={run().status}
                      aria-current={props.selected === run().id ? "true" : undefined}
                      class="flex w-full min-w-0 flex-col gap-0.5 rounded-[8px] px-3 py-2 text-left transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-v2-border-border-focus motion-reduce:transition-none"
                      classList={{
                        "bg-v2-overlay-simple-overlay-pressed [font-weight:600]": props.selected === run().id,
                      }}
                      onClick={() => props.select(run().id)}
                    >
                      <span class="flex min-w-0 items-center gap-2">
                        <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">
                          {store.workflows().find((item) => item.id === run().workflowID)?.name ??
                            language.t("secondBrain.run.workflowGone")}
                        </span>
                        <span class="shrink-0 type-meta text-v2-text-text-muted">
                          {language.t(`secondBrain.run.short.${run().status}`)}
                        </span>
                      </span>
                      <span class="min-w-0 truncate type-meta text-v2-text-text-muted">
                        {props.ctrl.projects().find((item) => item.id === run().project)?.name ??
                          language.t("secondBrain.run.projectGone")}
                      </span>
                    </button>
                  </li>
                )}
              </Show>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

/**
 * One run: its Project and workflow, the director thread's title, its status with Pause and Stop (Resume for a
 * paused run), the stop condition, rounds and spend against their limits, one block per round with each role's
 * latest entry, and links to the threads. The limits are enforced by the tracker while the app is open.
 */
export function WorkflowRunView(props: {
  run: WorkflowRun
  ctrl: SidebarController
  open: (sessionID: string) => void
  showProject: (projectID: string) => void
  removed: () => void
}) {
  const language = useLanguage()
  const serverSync = useServerSync()
  const store = useWorkflows()
  const statusText = useRunStatusText()
  const [state, setState] = createStore({ busy: false, failed: false })
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }))
  const workflow = () => store.workflows().find((item) => item.id === props.run.workflowID)
  const project = () => props.ctrl.projects().find((item) => item.id === props.run.project)
  const title = () =>
    sessionTitle(serverSync().session.get(props.run.sessionID)?.title) ||
    language.t("secondBrain.commandCentre.threads.untitled")
  const spend = () => store.spend(props.run)
  const round = () => currentRound(props.run)
  const active = () => props.run.status === "running" || props.run.status === "paused"
  const warn = () => props.run.status === "over-budget" || props.run.status === "out-of-rounds"

  // One request at a time; a failure shows the request-failed message and leaves the run as it was.
  const act = (request: (run: WorkflowRun) => Promise<unknown>) => {
    if (state.busy) return
    setState({ busy: true, failed: false })
    void request(props.run).then(
      () => setState("busy", false),
      () => setState({ busy: false, failed: true }),
    )
  }

  return (
    <section
      data-component="workflow-run"
      data-status={props.run.status}
      aria-label={language.t("secondBrain.run.view")}
      class="flex min-w-0 flex-1 flex-col gap-4"
    >
      <header class="flex flex-col gap-2">
        <p class="min-w-0 truncate type-meta text-v2-text-text-muted">
          {project()?.name ?? language.t("secondBrain.run.projectGone")}
          {" · "}
          {workflow()?.name ?? language.t("secondBrain.run.workflowGone")}
        </p>
        <h2 class="min-w-0 truncate type-toolbar-title text-v2-text-text-base">{title()}</h2>
        <div class="flex flex-wrap items-center gap-2">
          <span
            data-slot="run-status"
            class={chipClass}
            classList={{
              "bg-v2-background-bg-layer-02 text-v2-text-text-base": !warn(),
              "bg-v2-state-bg-warning text-v2-state-fg-warning": warn(),
            }}
          >
            <Show when={props.run.status === "running"}>
              <span class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent running-pulse" aria-hidden="true" />
            </Show>
            {statusText(props.run)}
          </span>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <Show when={props.run.status === "running"}>
              <ButtonV2
                size="small"
                variant="outline"
                data-action="run-pause"
                disabled={state.busy}
                onClick={() => act(store.pause)}
              >
                {language.t("secondBrain.run.pause")}
              </ButtonV2>
            </Show>
            <Show when={props.run.status === "paused"}>
              <ButtonV2
                size="small"
                variant="contrast"
                data-action="run-resume"
                disabled={state.busy}
                onClick={() => act(store.resume)}
              >
                {language.t("secondBrain.run.resume")}
              </ButtonV2>
            </Show>
            <Show when={active()}>
              <ButtonV2
                size="small"
                variant="outline"
                data-action="run-stop"
                disabled={state.busy}
                onClick={() => act(store.stop)}
              >
                {language.t("prompt.action.stop")}
              </ButtonV2>
            </Show>
            <Show when={!active()}>
              <ButtonV2
                size="small"
                variant="ghost"
                data-action="run-remove"
                onClick={() => {
                  store.removeRun(props.run.id)
                  props.removed()
                }}
              >
                {language.t("secondBrain.run.remove")}
              </ButtonV2>
            </Show>
          </div>
        </div>
        <Show when={state.failed}>
          <p role="alert" class="type-meta text-v2-text-text-critical">
            {language.t("common.requestFailed")}
          </p>
        </Show>
      </header>

      <div class="grid grid-cols-1 gap-3 @[620px]:grid-cols-2 @[1000px]:grid-cols-4">
        <div class={cardClass}>
          <span class="type-caption text-v2-text-text-muted">{language.t("secondBrain.run.repeats")}</span>
          <span class="type-row-title text-v2-text-text-base">{language.t("secondBrain.run.repeats.value")}</span>
        </div>
        <div data-slot="run-rounds" class={cardClass}>
          <span class="type-caption text-v2-text-text-muted">{language.t("secondBrain.run.rounds")}</span>
          <span class="type-row-title tabular-nums text-v2-text-text-base">
            {language.t("secondBrain.run.rounds.value", { round: round(), max: props.run.maxRounds })}
          </span>
          <Meter
            class="w-full"
            value={(round() / props.run.maxRounds) * 100}
            label={language.t("secondBrain.run.rounds.meter")}
          />
        </div>
        <div data-slot="run-spend" class={cardClass}>
          <span class="type-caption text-v2-text-text-muted">{language.t("secondBrain.run.spend")}</span>
          <span class="type-row-title tabular-nums text-v2-text-text-base">
            {props.run.budgetUSD === undefined
              ? usd().format(spend())
              : language.t("secondBrain.run.spend.of", {
                  spent: usd().format(spend()),
                  budget: usd().format(props.run.budgetUSD),
                })}
          </span>
          <Show when={props.run.budgetUSD}>
            {(budget) => (
              <Meter
                class="w-full"
                value={(spend() / budget()) * 100}
                label={language.t("secondBrain.run.spend.meter")}
              />
            )}
          </Show>
        </div>
        <div class={cardClass}>
          <span class="type-caption text-v2-text-text-muted">{language.t("secondBrain.run.limits")}</span>
          <span class="type-meta text-v2-text-text-base">{language.t("secondBrain.run.limits.body")}</span>
        </div>
      </div>

      <h3 class="px-1 type-section text-v2-text-text-base">{language.t("secondBrain.run.rounds")}</h3>
      <Show
        when={props.run.rounds.length > 0}
        fallback={<p class="px-1 type-body text-v2-text-text-muted">{language.t("secondBrain.run.rounds.empty")}</p>}
      >
        <ol data-slot="run-rounds-list" class="flex flex-col gap-3" aria-label={language.t("secondBrain.run.rounds")}>
          <For each={props.run.rounds}>
            {(item) => (
              <li data-round={item.n} data-outcome={item.outcome} class={`${cardClass} !gap-2`}>
                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 flex-1 truncate type-row-title text-v2-text-text-base">
                    {language.t("secondBrain.run.round", { n: item.n })}
                  </span>
                  <span
                    class={chipClass}
                    classList={{
                      "bg-v2-background-bg-layer-02 text-v2-text-text-base": item.outcome !== "approved",
                      "bg-v2-state-bg-accent text-v2-state-fg-accent": item.outcome === "approved",
                    }}
                  >
                    {language.t(`secondBrain.run.outcome.${item.outcome}`)}
                  </span>
                </div>
                <ul class="flex flex-col gap-1">
                  <For each={item.entries}>
                    {(entry) => (
                      <li data-entry={entry.role} class="flex min-w-0 items-baseline gap-2 type-body">
                        <span class="shrink-0 capitalize [font-weight:600] text-v2-text-text-base">{entry.role}</span>
                        <span class="shrink-0 type-meta text-v2-text-text-muted">
                          {language.t(`secondBrain.run.entry.${entry.status}`)}
                        </span>
                        <span class="min-w-0 flex-1 text-v2-text-text-muted">{entry.summary}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </li>
            )}
          </For>
        </ol>
      </Show>

      <div class="flex flex-wrap items-center gap-2">
        <ButtonV2
          size="small"
          variant="outline"
          data-action="run-open-thread"
          onClick={() => props.open(props.run.sessionID)}
        >
          {language.t("secondBrain.run.openThread")}
        </ButtonV2>
        <ButtonV2
          size="small"
          variant="outline"
          data-action="run-open-project"
          onClick={() => props.showProject(props.run.project)}
        >
          {language.t("secondBrain.run.openProject")}
        </ButtonV2>
      </div>
    </section>
  )
}
