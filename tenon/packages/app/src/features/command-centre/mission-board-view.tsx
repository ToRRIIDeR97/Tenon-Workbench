import { Harness } from "@tenon/schema/harness"
import { ButtonV2 } from "@tenon/ui/v2/button-v2"
import { Icon } from "@tenon/ui/v2/icon"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@tenon/ui/v2/segmented-control-v2"
import { createEffect, createMemo, For, Match, on, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { SidebarController } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { isCommandThread } from "@/features/command-centre/command-centre"
import { boardByProject, boardByState, steerText, type BoardThread } from "@/features/command-centre/mission-board"
import { lastUpdate } from "@/features/second-brain/sidebar-grouping"
import { currentRound } from "@/features/command-centre/workflow-run-view"
import { useWorkflows } from "@/features/command-centre/workflow-store"
import { flattenThreads } from "@/features/second-brain/sidebar-threads"
import { agentRunStatus, needsYou } from "@/pages/activity-runs"
import { Identifier } from "@/utils/id"
import { sessionTitle } from "@/utils/session-title"
import { getRelativeTime } from "@/utils/time"

/** A board thread plus what Steer and Stop need to reach it. */
export type MissionThread = BoardThread & { directory: string; harness: boolean }

type RowState = "needs-you" | "running" | "finished"

/**
 * Every root thread of the workspace's Projects (and its General group) as board rows. It reads the sidebar's
 * thread lists and the synced run state, so the board adds no request of its own. Command Centre threads never
 * show: their folder belongs to no Project.
 */
export function createMissionThreads(ctrl: SidebarController) {
  const language = useLanguage()
  const serverSync = useServerSync()
  return createMemo<MissionThread[]>(() => {
    const data = serverSync().session.data
    const value = ctrl.groups()
    const general = language.t("secondBrain.sidebar.workspaceThreads")
    const roots = [
      ...value.projects.flatMap((group) =>
        group.threads.map((node) => ({
          node,
          project: group.project.name,
          projectID: group.project.id as string | undefined,
        })),
      ),
      ...value.workspace.map((node) => ({ node, project: general, projectID: undefined as string | undefined })),
    ]
    return roots.flatMap((root): MissionThread[] => {
      const session = root.node.session
      if (isCommandThread(session.directory)) return []
      // Subagents wait on the user too, and the sidebar reports them under their root thread.
      const family = flattenThreads([root.node])
      const waited = family.reduce((sum, item) => sum + needsYou(data, item.id), 0)
      const subtree = ctrl.subtreeState(root.node)
      const waiting = waited > 0 ? waited : subtree === "approval" ? 1 : 0
      const harness = (session as { harnessInstanceID?: string }).harnessInstanceID
      return [
        {
          id: session.id,
          title: sessionTitle(session.title) || language.t("secondBrain.commandCentre.threads.untitled"),
          project: root.project,
          projectID: root.projectID,
          updated: lastUpdate(session),
          status:
            waiting > 0
              ? "approval"
              : (agentRunStatus(data.session_status[session.id], 0) ?? (subtree === "running" ? "running" : undefined)),
          waiting,
          subagents: family.length - 1,
          directory: session.directory,
          harness: !!harness && harness !== Harness.OpenCode,
        },
      ]
    })
  })
}

/**
 * The Command Centre's board of every Project's threads: needs you, running and finished (a day), or by Project.
 * Steer sends one line to a running thread; Stop aborts it; Review and Open go to the thread. A director thread of a
 * workflow run shows its round and opens the run view.
 */
export function MissionBoard(props: {
  ctrl: SidebarController
  threads: MissionThread[]
  open: (id: string) => void
  openRun: (runID: string) => void
  /** A Project to show: the board switches to By project and scrolls to it. */
  focusProject?: string
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const workflows = useWorkflows()
  const runByThread = createMemo(() => new Map(workflows.runs().map((run) => [run.sessionID, run] as const)))
  let root: HTMLElement | undefined
  const [state, setState] = createStore({
    view: "state" as "state" | "project",
    steer: undefined as string | undefined,
    text: "",
    busy: false,
    failed: undefined as string | undefined,
  })
  const byID = createMemo(() => new Map(props.threads.map((thread) => [thread.id, thread] as const)))
  const byState = createMemo(() => boardByState(props.threads, Date.now()))
  const byProject = createMemo(() => boardByProject(props.threads, Date.now()))
  const stateByID = createMemo(
    () =>
      new Map<string, RowState>([
        ...byState().finished.map((thread) => [thread.id, "finished"] as const),
        ...byState().running.map((thread) => [thread.id, "running"] as const),
        ...byState().needsYou.map((thread) => [thread.id, "needs-you"] as const),
      ]),
  )
  createEffect(
    on(
      () => props.focusProject,
      (id) => {
        if (!id) return
        setState("view", "project")
        queueMicrotask(() =>
          root?.querySelector(`[data-project="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }),
        )
      },
    ),
  )
  const empty = () => byState().needsYou.length + byState().running.length + byState().finished.length === 0

  const toggleSteer = (id: string) =>
    setState({ steer: state.steer === id ? undefined : id, text: "", failed: undefined })

  const steer = (thread: MissionThread) => {
    const text = steerText(state.text)
    if (!text || state.busy) return
    setState({ busy: true, failed: undefined })
    // The thread's own folder routes the request, as it does from the thread's page.
    void serverSDK()
      .ensureDirSdkContext(thread.directory)
      .api.session.prompt({
        sessionID: thread.id,
        id: Identifier.ascending("message"),
        text,
        delivery: "steer",
        harness: thread.harness,
      })
      .then(
        () => setState({ steer: undefined, text: "", busy: false }),
        () => setState({ failed: thread.id, busy: false }),
      )
  }

  const stop = (thread: MissionThread) => {
    setState("failed", undefined)
    void serverSDK()
      .ensureDirSdkContext(thread.directory)
      .api.session.interrupt({ sessionID: thread.id })
      .catch(() => setState("failed", thread.id))
  }

  // Rows are looked up by ID so a thread's update rewrites its row in place: an open Steer field keeps its focus.
  const Row = (row: { id: string; state: RowState; project: boolean }): JSX.Element => (
    <Show when={byID().get(row.id)}>
      {(thread) => {
        const run = () => runByThread().get(thread().id)
        // What the row says under its title: the Project (in By state), then what the thread is doing.
        const detail = () =>
          [
            row.project ? thread().project : undefined,
            run() && currentRound(run()!) > 0
              ? language.t("secondBrain.commandCentre.board.round", {
                  round: currentRound(run()!),
                  max: run()!.maxRounds,
                })
              : undefined,
            thread().subagents > 0
              ? language.t("secondBrain.commandCentre.board.subagents", { count: thread().subagents })
              : undefined,
            getRelativeTime(new Date(thread().updated).toISOString(), language.t),
          ]
            .filter(Boolean)
            .join(" · ")
        return (
          <li
            data-thread={thread().id}
            data-state={row.state}
            class="flex flex-col rounded-[16px]"
            classList={{
              "bg-v2-background-bg-layer-02": row.state === "needs-you",
              "shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]": row.state !== "needs-you",
            }}
          >
            <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
              <span class="flex size-5 shrink-0 items-center justify-center">
                <Switch>
                  <Match when={row.state === "needs-you"}>
                    <span
                      class="flex text-v2-state-fg-warning"
                      role="img"
                      aria-label={language.t("secondBrain.sidebar.needsYou")}
                    >
                      <Icon name="warning" size="small" />
                    </span>
                  </Match>
                  <Match when={row.state === "running"}>
                    <span
                      class="size-2 rounded-full bg-v2-icon-icon-accent running-pulse"
                      role="img"
                      aria-label={language.t("secondBrain.sidebar.running")}
                    />
                  </Match>
                  <Match when={true}>
                    <span
                      class="flex text-v2-icon-icon-muted"
                      role="img"
                      aria-label={language.t("secondBrain.commandCentre.board.finished")}
                    >
                      <Icon name="check" size="small" />
                    </span>
                  </Match>
                </Switch>
              </span>
              <button
                type="button"
                data-action="board-title"
                class="flex min-w-0 flex-[1_1_220px] flex-col items-start rounded-[8px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
                onClick={() => props.open(thread().id)}
              >
                <span class="w-full min-w-0 truncate type-row-title [font-weight:600] text-v2-text-text-base">
                  {thread().title}
                </span>
                <span data-slot="board-row-detail" class="w-full min-w-0 truncate type-meta text-v2-text-text-muted">
                  {detail()}
                </span>
              </button>
              <Show when={thread().waiting > 0}>
                <span class="shrink-0 rounded-full bg-v2-state-bg-warning px-2.5 py-0.5 type-caption text-v2-state-fg-warning">
                  {language.t("secondBrain.commandCentre.board.waiting", { count: thread().waiting })}
                </span>
              </Show>
              <div class="flex shrink-0 items-center gap-1.5">
                <Show when={row.state === "needs-you"}>
                  <ButtonV2
                    size="small"
                    variant="contrast"
                    data-action="board-review"
                    onClick={() => props.open(thread().id)}
                  >
                    {language.t("secondBrain.widget.review")}
                  </ButtonV2>
                </Show>
                <Show when={row.state === "running"}>
                  <ButtonV2
                    size="small"
                    variant="outline"
                    data-action="board-steer"
                    aria-expanded={state.steer === thread().id}
                    onClick={() => toggleSteer(thread().id)}
                  >
                    {language.t("secondBrain.composer.delivery.steer")}
                  </ButtonV2>
                  <ButtonV2 size="small" variant="outline" data-action="board-stop" onClick={() => stop(thread())}>
                    {language.t("prompt.action.stop")}
                  </ButtonV2>
                </Show>
                <Show when={run()}>
                  {(value) => (
                    <ButtonV2
                      size="small"
                      variant="outline"
                      data-action="board-run"
                      onClick={() => props.openRun(value().id)}
                    >
                      {language.t("secondBrain.commandCentre.board.openRun")}
                    </ButtonV2>
                  )}
                </Show>
                <Show when={row.state === "finished"}>
                  <ButtonV2
                    size="small"
                    variant="outline"
                    data-action="board-open"
                    onClick={() => props.open(thread().id)}
                  >
                    {language.t("common.open")}
                  </ButtonV2>
                </Show>
              </div>
            </div>
            <Show when={state.steer === thread().id}>
              <form
                class="px-3.5 pb-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  steer(thread())
                }}
              >
                <input
                  ref={(element) => queueMicrotask(() => element.focus())}
                  class="h-9 w-full min-w-0 rounded-full bg-v2-background-bg-base px-3 text-[13px] text-v2-text-text-base outline-none [box-shadow:inset_0_0_0_1px_var(--v2-border-border-base)] focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]"
                  value={state.text}
                  disabled={state.busy}
                  aria-label={language.t("secondBrain.commandCentre.board.steerLabel", { title: thread().title })}
                  placeholder={language.t("secondBrain.commandCentre.board.steerPlaceholder")}
                  onInput={(event) => setState("text", event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") toggleSteer(thread().id)
                  }}
                />
              </form>
            </Show>
            <Show when={state.failed === thread().id}>
              <p role="alert" class="px-3.5 pb-3 type-meta text-v2-text-text-critical">
                {language.t("common.requestFailed")}
              </p>
            </Show>
          </li>
        )
      }}
    </Show>
  )

  const states = [
    ["needs-you", "secondBrain.sidebar.needsYou", () => byState().needsYou],
    ["running", "secondBrain.sidebar.running", () => byState().running],
    ["finished", "secondBrain.commandCentre.board.finished", () => byState().finished],
  ] as const

  return (
    <section
      ref={root}
      data-component="mission-board"
      aria-labelledby="mission-board-title"
      class="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto rounded-[16px] bg-v2-background-bg-layer-01 p-5"
    >
      <div class="flex min-h-9 items-center gap-2">
        <h2 id="mission-board-title" class="min-w-0 flex-1 truncate type-section text-v2-text-text-base">
          {language.t("secondBrain.commandCentre.board.allProjects")}
        </h2>
        <SegmentedControlV2
          aria-label={language.t("secondBrain.commandCentre.board.view")}
          value={state.view}
          onChange={(value) => setState("view", value === "project" ? "project" : "state")}
        >
          <SegmentedControlItemV2 value="state" data-action="board-view">
            {language.t("secondBrain.commandCentre.board.byState")}
          </SegmentedControlItemV2>
          <SegmentedControlItemV2 value="project" data-action="board-view">
            {language.t("secondBrain.commandCentre.board.byProject")}
          </SegmentedControlItemV2>
        </SegmentedControlV2>
      </div>
      <Show when={props.ctrl.failed()}>
        <div class="flex flex-wrap items-center gap-2">
          <p role="alert" class="type-meta text-v2-text-text-critical">
            {language.t("secondBrain.error.request")}
          </p>
          <ButtonV2 size="small" variant="outline" onClick={props.ctrl.retryProjects}>
            {language.t("secondBrain.error.retry")}
          </ButtonV2>
        </div>
      </Show>
      <Show when={!empty()}>
        <Show
          when={state.view === "state"}
          fallback={
            <For each={byProject()}>
              {(group) => (
                <section data-project={group.projectID ?? "general"} class="flex flex-col gap-2">
                  <h3 class="px-1 type-caption text-v2-text-text-muted">{group.project}</h3>
                  <ul class="flex flex-col gap-2">
                    <For each={group.threads.map((thread) => thread.id)}>
                      {(id) => <Row id={id} project={false} state={stateByID().get(id) ?? "finished"} />}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          }
        >
          <For each={states}>
            {(group) => (
              <Show when={group[2]().length > 0}>
                <section data-group={group[0]} class="flex flex-col gap-2">
                  <h3 class="flex items-center gap-1.5 px-1 type-caption text-v2-text-text-muted">
                    {language.t(group[1])}
                    <span aria-hidden="true">·</span>
                    <span class="tabular-nums">{group[2]().length}</span>
                  </h3>
                  <ul class="flex flex-col gap-2">
                    <For each={group[2]().map((thread) => thread.id)}>
                      {(id) => <Row id={id} project state={group[0]} />}
                    </For>
                  </ul>
                </section>
              </Show>
            )}
          </For>
        </Show>
      </Show>
      <Show when={empty() && !props.ctrl.loading() && !props.ctrl.failed()}>
        <p class="px-1 type-body text-v2-text-text-muted">{language.t("secondBrain.commandCentre.board.empty")}</p>
      </Show>
    </section>
  )
}
